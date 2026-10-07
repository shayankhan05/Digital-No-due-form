import {MongoClient} from 'mongodb';
import {initializeModels} from './models/index.js';
export async function connectDatabase(uri){if(!uri)throw new Error('MONGODB_URI is required.');const client=new MongoClient(uri);await client.connect();const database=client.db();await initializeModels(database);return {client,database};}
