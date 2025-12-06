// 通知本地缓存用的 IndexedDB 封装（独立于私信 pmIndexedDb）

const DB_NAME = 'notification_db_v1';
const DB_VERSION = 1;

const STORE_NOTIFICATIONS = 'notifications';

let dbPromise = null;

export function openNotificationDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB not supported'));
            return;
        }

        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NOTIFICATIONS)) {
                const store = db.createObjectStore(STORE_NOTIFICATIONS, {
                    keyPath: 'id', // 我们自己生成的 key
                });
                // 按 userId + createdAt 做索引，后续按范围读取
                store.createIndex(
                    'by_user_createdAt',
                    ['userId', 'createdAt'],
                    { unique: false }
                );
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

/**
 * 生成通知的主键：userId + type + referenceId + createdAt
 * 保证同一条不会重复写。
 */
export function buildNotificationKey(userId, n) {
    if (!userId || !n) return null;
    const t = n.type || 'UNKNOWN';
    const rid = n.requestId ?? n.referenceId ?? '0';
    // 持久化主键不包含 createdAt，这样同一（type+rid）会被覆盖，避免重复存储
    return `${userId}#${t}#${rid}`;
}

/**
 * 批量写入通知到本地缓存，按 userId 维度裁剪到 limit 条。
 */
export async function saveNotificationsToCache(
    userId,
    notifications,
    limitPerUser = 500
) {
    if (!userId || !Array.isArray(notifications) || notifications.length === 0) return;
    const db = await openNotificationDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NOTIFICATIONS], 'readwrite');
        const store = tx.objectStore(STORE_NOTIFICATIONS);

        notifications.forEach((n) => {
            if (!n) return;
            const key = buildNotificationKey(userId, n);
            if (!key) return;

            const created =
                n.createdAt != null
                    ? typeof n.createdAt === 'number'
                        ? n.createdAt
                        : new Date(n.createdAt).getTime() || Date.now()
                    : Date.now();

            const record = {
                ...n,
                id: key,
                userId,
                createdAt: created,
            };
            store.put(record);
        });

        tx.oncomplete = async () => {
            try {
                await trimNotificationsIfNeeded(db, userId, limitPerUser);
                resolve();
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[notificationIndexedDb] trim error', e);
                resolve();
            }
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * 读取最近 N 条通知（按时间降序）
 */
export async function loadRecentNotificationsFromCache(userId, limit = 500) {
    const db = await openNotificationDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTIFICATIONS, 'readonly');
        const store = tx.objectStore(STORE_NOTIFICATIONS);
        const index = store.index('by_user_createdAt');

        const lower = [userId, 0];
        const upper = [userId, 8_640_000_000_000_000]; // 大概 275760 年

        const range = IDBKeyRange.bound(lower, upper);

        const result = [];
        index.openCursor(range, 'prev').onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                resolve(result.slice(0, limit));
                return;
            }
            result.push(cursor.value);
            if (result.length >= limit) {
                resolve(result);
                return;
            }
            cursor.continue();
        };

        tx.onerror = () => reject(tx.error);
    });
}

/**
 * 裁剪超出 limit 条的旧通知（按 userId 维度）。
 */
async function trimNotificationsIfNeeded(db, userId, limit) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTIFICATIONS, 'readwrite');
        const store = tx.objectStore(STORE_NOTIFICATIONS);
        const index = store.index('by_user_createdAt');

        const lower = [userId, 0];
        const upper = [userId, 8_640_000_000_000_000];
        const range = IDBKeyRange.bound(lower, upper);

        const allKeys = [];
        index.openKeyCursor(range, 'next').onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                const over = allKeys.length - limit;
                if (over > 0) {
                    for (let i = 0; i < over; i++) {
                        store.delete(allKeys[i]);
                    }
                }
                return;
            }
            allKeys.push(cursor.primaryKey);
            cursor.continue();
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * 从本地缓存删除一条通知（按 userId + type + id）
 * n 可以是完整通知对象，也可以是 { type: 'FRIEND_REQUEST', requestId: id } 之类的简化对象
 */
export async function deleteNotificationFromCache(userId, n) {
    if (!userId || !n) return;
    const db = await openNotificationDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction([STORE_NOTIFICATIONS], 'readwrite');
            const store = tx.objectStore(STORE_NOTIFICATIONS);
            const key = buildNotificationKey(userId, n);
            if (!key) {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                return;
            }
            store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[notificationIndexedDb] deleteNotificationFromCache error', e);
            reject(e);
        }
    });
}