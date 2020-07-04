# mongodb-corrupted-data-recovery-script
Recovering a WiredTiger collection from a corrupt MongoDB installation

## Get Started

**Important Note**

`Only supported in linux operator. We refer to you to use ubuntu`.

### Node Engine

- node
    v10.19.0
 - npm
    6.14.4

### Initial Setup(first time only)

- Install Wiredtiger

```
wget http://source.wiredtiger.com/releases/wiredtiger-2.7.0.tar.bz2
tar xvf wiredtiger-2.7.0.tar.bz2
cd wiredtiger-2.7.0
sudo apt install libsnappy-dev build-essential
./configure --enable-snappy
make
```

- Install node_modules packages

```
cd ../
npm install
```

### Run Script

- Before running this script, you must know what is DBCode and CollectionCode.(Explanation in below section)

* Arguments

```
--dbpath   - Input of the corrupted mongodb data path.
--dblists  - Mention the list of databases, Only you want to recovery it.
```

In that dblists argument, You give values for string array of object.for example,

```
  "[{dbCode: '1238759449822491237', dbName: 'Recovery', collections: { '13': 'borkedCollection', '14': 'borkedCollection_1' }}]"
```

- It stands for,
    - dbCode - Database code,(String)(Mandatory)
    - dbName - Database name,(String)(Optional)
    - collections: { key - Collection code: value - Collection name }(Object)(Optional)


- If you want to know more information, use

```
node script.js --help
node script.js -h
```

* Recovery all databases

```
node script.js --dbpath /path/to/corrupted-mongodb
```

* Recovery Only Specific databases

```
node script.js --dbpath /path/to/corrupted-mongodb --dblists "[{dbCode: '1238759449822491237', dbName: 'Recovery', collections: { '13': 'borkedCollection', '14': 'borkedCollection_1' }}]"
```

### How to Get DB CODE and COLLECTION CODE

In that `/path/to/corrupted-mongodb` folder inside you will see bunch of files.

In that bunch of files You want to find file name look like `collection-13--1238759449822491237.wt`.

```
 13 - Collection code.(Only for one collection)
 1238759449822491237 - Database code.(same for all collections)
```

Once you find that, copy that code paste in dblists property values.


