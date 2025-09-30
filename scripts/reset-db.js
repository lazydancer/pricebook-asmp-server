const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { removeWalFiles, openDatabase } = require('../lib/db');
const { SCHEMA_DDL } = require('../lib/schema');

dotenv.config();

const DB_FILE = process.env.DB_FILE || 'asmp.db';

const targetPath = path.resolve(DB_FILE);

if (fs.existsSync(targetPath)) {
  fs.unlinkSync(targetPath);
  removeWalFiles(targetPath);
}

const db = openDatabase(targetPath);
db.exec(SCHEMA_DDL);
db.close();

console.log(`Database reset at ${targetPath}`);
