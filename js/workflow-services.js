export const REQUIRED_SERVICES=['library','accounts','sports'];
export const LAB_SERVICES=['physics_lab','chemistry_lab'];
export function labRequirements(config={},semester){const defaults=Number(semester)===1||Number(semester)===2,configured=config?.labRequirements?.[Number(semester)]||{};return Object.fromEntries(LAB_SERVICES.map(role=>[role,typeof configured[role]==='boolean'?configured[role]:defaults]));}
export const requiredServices=(config,semester)=>[...REQUIRED_SERVICES,...LAB_SERVICES.filter(role=>labRequirements(config,semester)[role])];
