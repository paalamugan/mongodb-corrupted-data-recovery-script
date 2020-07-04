//requiring path and fs modules
const path     = require('path');
const fs       = require('fs');
const util     = require('util');
const exec     = util.promisify(require('child_process').exec);

const _        = require('lodash');
const async    = require('async');
const mongoose = require('mongoose');
const yargs    = require('yargs');
const Schema   = mongoose.Schema;

const pkgJSON  = require('./package.json');
const rootPath = path.resolve(__dirname);

let corruptedMongoDBPath = '';
let dbLists = [];
let processAllDatabase = true;
let debug = true;

const argv = yargs
    .option('dbpath', {
        description: 'Input of the corrupted mongodb data path(Mandatory)',
        type: 'string',
    })
    .option('dblists', {
        description: "Mention the list of databases, Only you want to recovery it(Optional).",
        type: 'string',
    })
    .option('processAllDatabase', {
        description: 'If set true, Process all databases.(Default true).\n If set false, Only Process dblists databases.',
        type: 'boolean',
    })
    .option('debug', {
        description: 'Run a script with debug mode.(Default true)',
        type: 'boolean',
    })
    .demandOption('dbpath', 'Please provide dbpath arguments to work with this tool')
    .version(pkgJSON.version)
    .alias('version', 'v')
    .describe('version', 'Show version information')
    .help()
    .alias('help', 'h')
    .argv;

if (argv.hasOwnProperty('dbpath'))
    corruptedMongoDBPath = argv.dbpath;

if (argv.hasOwnProperty('dblists')) {

    try {

        var dblists = eval(`${argv.dblists}`);

        if (!_.isArray(dblists))
            throw new Error(`Invalid dblists data.`);

        if (!dblists.length)
            throw new Error(`dblists is empty.`);

    } catch (err) {
       return console.error(err);
    }

    dbLists = dblists;

}

if (argv.hasOwnProperty('processAllDatabase'))
    processAllDatabase = argv.processAllDatabase;

if (argv.hasOwnProperty('debug'))
    debug = argv.debug;

// console.log("argv: ", argv);

if (dbLists.length && !argv.hasOwnProperty('processAllDatabase'))
    processAllDatabase = false;

if (!processAllDatabase && !dbLists.length)
    return console.error(new Error('--dblists args is missing. Give some databases information!'));

//joining path of directory
const wtPath = `${rootPath}/wiredtiger-2.7.0`;
const dumpCollectionPath = `${rootPath}/dump-collections`;
const dumpMongoDBPath = `${rootPath}/dump-mongodb`;
const recoveredMongoDBPath = `${rootPath}/recovered-mongodb`;

const wt = wtPath + '/wt';

if (!corruptedMongoDBPath)
    return console.error(new Error(`--dbpath value is missing. Give corrupted mongoDB path!`));

if (!fs.existsSync(corruptedMongoDBPath))
    return console.error(new Error(`${corruptedMongoDBPath} folder not found!`));

if (!fs.existsSync(wtPath))
    return console.error(new Error(`wiredtiger-2.7.0 folder not found!`));


var removeAllFiles = async (directory) => {

    if (!fs.existsSync(directory)) {

        fs.mkdirSync(directory);

    } else {

        await exec(`rm -rf ${directory}/*`);

    }

    return null;

};

var getDBCode = (fileName) => {

    var splits = fileName.split('-');
    var dbCode = splits[splits.length - 1].replace('.wt', '');

    return dbCode;
};

var getDBCollectionCode = (fileName) => {

    var splits = fileName.split('-');

    return splits[1];
};


var startMongodb = async () => {

    try {

        await exec('ps -e | grep mongo');

    } catch (err) {

        await exec(`mongod --dbpath ${recoveredMongoDBPath} --fork --storageEngine wiredTiger --nojournal --logpath /var/log/mongodb.log`);

    }
}

var stopMongodb = async () => {

    try {

        await exec('ps -e | grep mongo');

        // var pid = await exec(`pgrep -f mongo`);
        // await exec(`kill ${pid.stdout}`);

        await exec(`mongod --dbpath ${recoveredMongoDBPath} --shutdown`);

    } catch (err) {}
};

var wtCommand = (data) => {

    var cmd = "";

    var type = data.type;
    var fileName = data.fileName;
    var dbCode = data.dbCode;
    var collectionName = data.collectionName;

    if (!type || !fileName) {
        return cmd;
    }

    var inputWTPath = (type !== 'load') ? corruptedMongoDBPath : recoveredMongoDBPath;

    cmd = `${wt} -v -h ${inputWTPath} -C \
              "extensions=[${wtPath}/ext/compressors/snappy/.libs/libwiredtiger_snappy.so]" \
              -R ${type} `;

    if (type === 'salvage') {
        cmd += fileName;
        return cmd;
    }

    fileName = fileName.replace('.wt', '');

    var dumpFilePath = `${dumpCollectionPath}/collection-${collectionName}-${dbCode}.dump`;

    if ((type === 'load') && !fs.existsSync(dumpFilePath)) {
        return { cmd: '', fileName: '' };
    }

    cmd += (type === 'dump') ? `-f ${dumpFilePath} ${fileName}` :
           (type === 'load') ? `-f ${dumpFilePath} -r ${fileName}` : '';

    return { cmd, fileName: path.basename(dumpFilePath) };

}

var createDumpCollection = async (data) => {

    try {

        data.type = 'salvage';
        var salvageCommand = wtCommand(data);

        data.type = 'dump';
        var dumpCommand = wtCommand(data);

        // console.log("cmd: ", salvageCommand);
        // console.log("cmd: ", dumpCommand.cmd);

        await exec(salvageCommand);
        await exec(dumpCommand.cmd);

        return dumpCommand.fileName;

    } catch (err) {

        throw err;
    }

}

var dumpCollections = async (collections, db) => {

    return new Promise((resolve, reject) => {

        if (debug)
            console.log(`Started Creating Dumps in ${db.dbName} DB`);

        async.eachSeries(collections, async (fileName) => {

            try {

                var data =  {
                    fileName: fileName,
                    dbCode: db.dbCode,
                    collectionName: db.collections[getDBCollectionCode(fileName)]
                }

                let dumpFileName = await createDumpCollection(data);

                if (debug)
                    console.log(`Created dump file ${dumpFileName}`);

            } catch (err) {

                throw err;
            }


        }, (err) => {

            if (err) {
                return reject(err);
            }

            if (debug)
                console.log(`Finished Creating Dumps in ${db.dbName} DB\n`);

            resolve(null);

        });
    });

};

var createCollections = async (client, db) => {

    var newCollections = [];

    return new Promise((resolve, reject) => {

        if (debug)
            console.log(`Started Creating Collections in ${client.name} DB`);

        async.eachSeries(db.collections, async (collectionName) => {

            try {

                if (!collectionName) return;

                const dummySchema = new Schema({ name: String });

                const Model = client.model(collectionName, dummySchema, collectionName.toLowerCase());

                const dummy = await Model.create({ name: 'dummy'});
                await dummy.remove();

                var getCollection = await client.collection(collectionName.toLowerCase());

                var stats = await getCollection.stats();

                var data = {
                    fileName: stats.wiredTiger.uri.replace('statistics:table:', ''),
                    collectionName: collectionName,
                    dbCode: db.dbCode,
                    dbName: db.dbName
                };

                if (debug)
                    console.log(`Created ${data.collectionName.toUpperCase()} ${data.fileName}`);

                newCollections.push(data);

            } catch (err) {
                throw err;
            }

        }, async (err) => {

            if (err) {
                return reject(err);
            }

            if (debug)
                console.log(`Finished Creating Collections in ${client.name} DB\n`);

            return resolve(newCollections);

        });
    });

}

var mongoDBConnection = async (db) => {

    return new Promise(async (resolve, reject) => {

        mongoose.connect(`mongodb://localhost/${db.dbName}`, { useNewUrlParser: true, useUnifiedTopology: true });

        var client = mongoose.connection;

        client.once('open', async () => {

            var newCollections = [];

            // if (debug)
            //     console.log(`${client.name} DB Connection is Opened.`);

            try {

                newCollections = await createCollections(client, db);
                await client.close();

            } catch (err) {
                return reject(err);
            }

            // if (debug)
            //     console.log(`${client.name} DB Connection is Closed.`);

            return resolve(newCollections);

        });

        client.on('error', (err) => {
            return reject(err);
        });
    })
}

var startProcessing = async (results) => {

    await removeAllFiles(recoveredMongoDBPath);

    await startMongodb();

    return new Promise ((resolve, reject) =>  {

        var allNewCollections = [];

        async.eachSeries(results, async (result) => {

            result.db.dbName = result.db.dbName.toLowerCase();

             try {

                await dumpCollections(result.collectionFileNames, result.db);

                // if (debug)
                //     console.log(`\nConnecting Database ${result.db.dbName}`);

                var newCollections = await mongoDBConnection(result.db);

                // if (debug)
                //     console.log(`Disconnected Database ${result.db.dbName}\n`);

                allNewCollections = allNewCollections.concat(newCollections);


            } catch (err) {

                throw err;

            }

        }, async (err) => {

            if (err) {
                return reject(err);
            }

            await stopMongodb();

            if (debug)
                console.log(`\nStarted load all db collections.\n`);

            async.eachSeries(allNewCollections, async (collection) => {

                collection.type = 'load';

                let loadCommand = wtCommand(collection);

                if (!loadCommand.cmd)
                    return;

                try {

                    let loadResult = await exec(loadCommand.cmd);

                    if (debug)
                        // console.log(`Loaded Collection ${collection.collectionName} in ${collection.dbName.toUpperCase()} DB`)
                        console.log(loadResult.stdout.trim());

                } catch (err) {
                    throw err;
                }

            }, async (err) => {

                if (err) {
                    return reject(err);
                }

                if (debug)
                    console.log(`\nFinished load all db collections.\n`);

                resolve(null);

            });

        });

    })
}


var start = async () => {

    console.log("\nStarted Recovering corrupted data. Please wait a while.....\n");

    try {
        await removeAllFiles(dumpCollectionPath);
    } catch (err) {
        throw err;
    }


    return new Promise((resolve, reject) => {

        fs.readdir(corruptedMongoDBPath, async (err, files) => {
            //handling error
            if (err) {
                return reject(new Error(`Unable to scan directory: ${err}`));
            }

            files = files || [];

            var allCollectionNames = _.filter(files, (file) => (/^collection.*wt$/).test(file));

            if (!allCollectionNames.length) {
                return reject(new Error(`Collections files not found!`));
            }

            // console.log("allCollectionNames", allCollectionNames);

            var groupByDBCode = _.groupBy(allCollectionNames, (file) => {

                return getDBCode(file);
            });

            var results = [];
            var index = 0;

            _.forEach(groupByDBCode, (values, key) => {

                var isDbLists = _.findIndex(dbLists, { dbCode: key }) > -1 ? true : false;

                if (!processAllDatabase && !isDbLists) {
                    return;
                }

                var result = {
                    collectionFileNames: values
                };

                var db = _.find(dbLists, (db) => (db.dbCode === key)) || {};

                if (!db.dbName) {
                    index += 1;
                }

                db.dbName = db.dbName || `Recovery_${index}`;
                db.dbCode = db.dbCode || key;
                db.collections = db.collections || {};

                _.forEach(values, (fileName, i) => {

                    i += 1;

                    var collectionCode = getDBCollectionCode(fileName);

                    if (!db.collections[collectionCode]) {

                        db.collections[collectionCode] = `borkedCollection_${i}`;

                    }
                });

                result.db = db;

                results.push(result);

            });

            try {

                if (!results.length) throw new Error('Invalid dbCode. Give valid dbCode!');

                await startProcessing(results);

                console.log("\nFinished Recovering corrupted data.\n");

                await startMongodb();

                await removeAllFiles(dumpMongoDBPath);

                console.log("Backup mongodb collections.");

                await exec(`mongodump --out ${dumpMongoDBPath}`); // custom path
                // await exec(`mongodump`);

                console.log("Restore mongodb collections.");

                await exec(`mongorestore --drop --dir ${dumpMongoDBPath}`); // custom path
                // await exec(`mongorestore --drop`);

                await stopMongodb();

                console.log(`\nSuccessfully Recovered all database collections.`);
                console.log(`Outputh Path: ${recoveredMongoDBPath}\n\n`);

                return resolve(`MongoDB Server Command: mongod --dbpath ${recoveredMongoDBPath}\n\n`);

            } catch (err) {
                return reject(err);
            }
        });
    });

}

start()
.then(console.log)
.catch(async (err) => {

    console.error(err);

    await stopMongodb();

    process.exit(0);

});

process.on('SIGINT', async () => {
  await stopMongodb();
});

