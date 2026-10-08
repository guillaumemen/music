// Stockage local (IndexedDB) : métadonnées des projets + fichiers audio.
// Rien ne quitte le navigateur.
const DB_NAME = 'flowlab';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => (result = r));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function listProjects() {
  return run(['projects'], 'readonly', (tx) => request(tx.objectStore('projects').getAll())).then((all) =>
    all.sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export function getProject(id) {
  return run(['projects'], 'readonly', (tx) => request(tx.objectStore('projects').get(id)));
}

export function saveProject(project) {
  return run(['projects'], 'readwrite', (tx) => {
    tx.objectStore('projects').put({ ...project, updatedAt: Date.now() });
  });
}

export function getAudio(id) {
  return run(['audio'], 'readonly', (tx) => request(tx.objectStore('audio').get(id)));
}

export function createProject(project, blob) {
  return run(['projects', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('projects').put(project);
    tx.objectStore('audio').put(blob, project.id);
  });
}

export function deleteProject(id) {
  return run(['projects', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('projects').delete(id);
    tx.objectStore('audio').delete(id);
  });
}
