/**
 * IndexedDB Cache Service for persistent search results
 * Survives page reloads and browser restarts
 */

const DB_NAME = 'vericorp_cache';
const DB_VERSION = 1;
const STORE_NAME = 'search_results';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let dbInstance: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
};

export interface CachedResult {
    key: string;
    data: any[];
    timestamp: number;
    exactCount: number;
    nearbyCount: number;
}

export const indexedDBCache = {
    /**
     * Get cached search results
     */
    get: async (key: string): Promise<CachedResult | null> => {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(key);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const result = request.result as CachedResult | undefined;
                    if (!result) {
                        resolve(null);
                        return;
                    }

                    // Check TTL
                    if (Date.now() - result.timestamp > CACHE_TTL_MS) {
                        // Expired - delete async and return null
                        indexedDBCache.delete(key);
                        resolve(null);
                        return;
                    }

                    resolve(result);
                };
            });
        } catch (e) {
            console.warn('IndexedDB get failed:', e);
            return null;
        }
    },

    /**
     * Save search results to cache
     */
    set: async (key: string, data: any[], exactCount: number, nearbyCount: number): Promise<void> => {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const entry: CachedResult = {
                    key,
                    data,
                    timestamp: Date.now(),
                    exactCount,
                    nearbyCount
                };
                const request = store.put(entry);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
        } catch (e) {
            console.warn('IndexedDB set failed:', e);
        }
    },

    /**
     * Delete a specific cache entry
     */
    delete: async (key: string): Promise<void> => {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.delete(key);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
        } catch (e) {
            console.warn('IndexedDB delete failed:', e);
        }
    },

    /**
     * Clear all cached search results
     */
    clearAll: async (): Promise<void> => {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.clear();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    console.log('🧹 IndexedDB cache cleared');
                    resolve();
                };
            });
        } catch (e) {
            console.warn('IndexedDB clear failed:', e);
        }
    },

    /**
     * Get cache statistics
     */
    getStats: async (): Promise<{ count: number; totalSize: number }> => {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const countRequest = store.count();

                countRequest.onerror = () => reject(countRequest.error);
                countRequest.onsuccess = () => {
                    resolve({ count: countRequest.result, totalSize: 0 }); // Size estimation would require iteration
                };
            });
        } catch (e) {
            return { count: 0, totalSize: 0 };
        }
    }
};

export default indexedDBCache;
