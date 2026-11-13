use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};

pub struct Vault { connection: Mutex<Connection>, key: [u8; 32] }

fn encrypt(key: &[u8; 32], bytes: &[u8], context: &str) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Clave de cifrado inválida.")?;
    let mut nonce = [0u8; 12]; OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: bytes, aad: context.as_bytes() }).map_err(|_| "No se pudo cifrar la información.")?;
    let mut result = nonce.to_vec(); result.extend(ciphertext); Ok(result)
}
fn decrypt(key: &[u8; 32], bytes: &[u8], context: &str) -> Result<Vec<u8>, String> {
    if bytes.len() < 28 { return Err("Registro cifrado incompleto.".into()); }
    Aes256Gcm::new_from_slice(key).map_err(|_| "Clave inválida.")?
        .decrypt(Nonce::from_slice(&bytes[..12]), Payload { msg: &bytes[12..], aad: context.as_bytes() })
        .map_err(|_| "No se pudo verificar el registro cifrado. Conserva la base antes de restablecer el almacén seguro.".into())
}
impl Vault {
    pub fn open(dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let key_entry = keyring::Entry::new("mx.contaez.desktop", "database-master-key-v1").map_err(|e| format!("Almacén seguro no disponible: {e}"))?;
        let database_exists = dir.join("contaez.sqlite").exists();
        let encoded = match key_entry.get_password() {
            Ok(k) => k,
            Err(keyring::Error::NoEntry) => {
                if database_exists { return Err("Falta la clave del almacén seguro para la base existente. No se generó una clave nueva ni se modificaron tus datos.".into()); }
                let mut key = [0u8; 32]; OsRng.fill_bytes(&mut key); let encoded = STANDARD.encode(key);
                key_entry.set_password(&encoded).map_err(|e| format!("No se pudo proteger la clave del proyecto: {e}"))?; encoded
            },
            Err(e) => return Err(format!("No se pudo abrir el almacén seguro del sistema: {e}")),
        };
        let decoded = STANDARD.decode(encoded).map_err(|_| "Clave de almacén seguro dañada.")?;
        let key: [u8; 32] = decoded.try_into().map_err(|_| "Tamaño de clave inválido.")?;
        let connection = Connection::open(dir.join("contaez.sqlite")).map_err(|e| e.to_string())?;
        connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(kind,id));").map_err(|e| e.to_string())?;
        Ok(Self { connection: Mutex::new(connection), key })
    }
    pub fn save(&self, kind: &str, id: &str, value: &Value) -> Result<(), String> {
        let payload = encrypt(&self.key, &serde_json::to_vec(value).map_err(|e| e.to_string())?, &format!("{kind}:{id}"))?;
        self.connection.lock().map_err(|_| "La base está ocupada.")?
            .execute("INSERT INTO records(kind,id,payload,updated) VALUES(?1,?2,?3,unixepoch()) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated", params![kind,id,payload]).map_err(|e| e.to_string())?; Ok(())
    }
    pub fn get(&self, kind: &str, id: &str) -> Result<Option<Value>, String> {
        let connection = self.connection.lock().map_err(|_| "La base está ocupada.")?;
        let mut statement = connection.prepare("SELECT payload FROM records WHERE kind=?1 AND id=?2").map_err(|e| e.to_string())?;
        let mut rows = statement.query(params![kind,id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => { let payload: Vec<u8> = row.get(0).map_err(|e| e.to_string())?; Ok(Some(serde_json::from_slice(&decrypt(&self.key,&payload,&format!("{kind}:{id}"))?).map_err(|e| e.to_string())?)) },
            None => Ok(None),
        }
    }
    pub fn list(&self, kind: &str) -> Result<Vec<Value>, String> {
        let connection = self.connection.lock().map_err(|_| "La base está ocupada.")?;
        let mut statement = connection.prepare("SELECT id,payload FROM records WHERE kind=?1 ORDER BY updated DESC,id").map_err(|e| e.to_string())?;
        let rows = statement.query_map([kind], |r| Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).map_err(|e| e.to_string())?;
        rows.map(|r| { let (id,payload) = r.map_err(|e| e.to_string())?; serde_json::from_slice(&decrypt(&self.key,&payload,&format!("{kind}:{id}"))?).map_err(|e| e.to_string()) }).collect()
    }
    pub fn delete(&self, kind: &str, id: &str) -> Result<(), String> { self.connection.lock().map_err(|_| "La base está ocupada.")?.execute("DELETE FROM records WHERE kind=?1 AND id=?2",params![kind,id]).map_err(|e| e.to_string())?; Ok(()) }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn encrypted_records_authenticate_and_randomize() {
        let key = [42u8;32]; let plain = b"RFC y datos contables privados";
        let a = encrypt(&key, plain,"project:uno").unwrap(); let b = encrypt(&key, plain,"project:uno").unwrap();
        assert_ne!(a,b); assert!(!a.windows(plain.len()).any(|s| s == plain)); assert_eq!(decrypt(&key,&a,"project:uno").unwrap(),plain);
        let mut damaged = a.clone(); damaged[20] ^= 1; assert!(decrypt(&key,&damaged,"project:uno").is_err()); assert!(decrypt(&[1u8;32],&a,"project:uno").is_err());
        assert!(decrypt(&key,&a,"project:otro").is_err());
    }
    #[test] fn project_database_roundtrip_uses_authenticated_records() {
        let connection=Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(kind,id));").unwrap();
        let vault=Vault{connection:Mutex::new(connection),key:[7u8;32]};
        let original=serde_json::json!({"id":"p1","name":"Cuenta privada","jurisdiction":"MX","operations":[{"amount":"123.45"}]});
        vault.save("project","p1",&original).unwrap(); assert_eq!(vault.get("project","p1").unwrap(),Some(original.clone())); assert_eq!(vault.list("project").unwrap(),vec![original]);
        let payload:Vec<u8>=vault.connection.lock().unwrap().query_row("SELECT payload FROM records",[],|r|r.get(0)).unwrap();
        assert!(!String::from_utf8_lossy(&payload).contains("Cuenta privada"));
        vault.delete("project","p1").unwrap();assert!(vault.list("project").unwrap().is_empty());
    }
    #[test] fn system_key_store_can_protect_and_remove_a_temporary_secret() {
        let user=format!("native-test-{}",uuid::Uuid::new_v4());
        let entry=keyring::Entry::new("mx.contaez.selftest",&user).unwrap();
        entry.set_password("temporary-test-secret").expect("El almacén seguro del sistema debe estar disponible");
        let result=entry.get_password();let cleanup=entry.delete_credential();
        assert_eq!(result.unwrap(),"temporary-test-secret");cleanup.unwrap();assert!(matches!(entry.get_password(),Err(keyring::Error::NoEntry)));
    }
}
