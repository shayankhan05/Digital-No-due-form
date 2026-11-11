import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {EJSON} from 'bson';
export function sealAdministrativeBackup(records,key=process.env.TEST_DATA_BACKUP_KEY){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))throw Object.assign(Error('Configure TEST_DATA_BACKUP_KEY before this administrative operation.'),{code:'failed-precondition'});
 const secret=Buffer.from(key,'hex'),iv=randomBytes(12),plain=Buffer.from(EJSON.stringify(records,{relaxed:false})),cipher=createCipheriv('aes-256-gcm',secret,iv),data=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
 const verify=createDecipheriv('aes-256-gcm',secret,iv);verify.setAuthTag(tag);if(!Buffer.concat([verify.update(data),verify.final()]).equals(plain))throw Error('Backup verification failed.');
 if(data.length>12_000_000)throw Error('Administrative backup exceeds the safe document limit.');
 return {_id:randomUUID(),createdAt:new Date(),algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:tag.toString('base64'),data:data.toString('base64')};
}
