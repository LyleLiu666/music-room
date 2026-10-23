/** Copy JSON-shaped service records, retaining undefined fields used by rollback.
 * Avoid structuredClone's native serialization buffers on every full-library
 * transaction. Binary/native leaves in operation results keep their native
 * clone behavior. Persisted records do not contain cyclic object graphs.
 */
export function copyPlainData<T>(value:T):T{
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(item=>copyPlainData(item)) as T;
 if(Object.getPrototypeOf(value)!==Object.prototype)return structuredClone(value);
 const result={...value};
 for(const key of Object.keys(result) as (keyof T)[])result[key]=copyPlainData(value[key]);
 return result;
}
