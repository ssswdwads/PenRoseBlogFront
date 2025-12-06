// 通知本地缓存服务，供 PendingFriendRequests.jsx 等使用。

// 注意：本文件位于 src/utils/ 目录，notificationIndexedDb.js 也在同一目录，
// 因此这里使用 './notificationIndexedDb' 是正确的相对路径。
import {
    saveNotificationsToCache,
    loadRecentNotificationsFromCache,
    buildNotificationKey,
} from './notificationIndexedDb';

import { deleteNotificationFromCache as _deleteFromDb } from './notificationIndexedDb';

/**
 * 从缓存中删除一条通知（供业务组件调用）
 */
export async function deleteNotificationFromCache(meId, n) {
    if (!meId || !n) return;
    try {
        await _deleteFromDb(meId, n);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[localNotificationCacheService] deleteNotificationFromCache error', e);
    }
}

/**
 * 从本地缓存预加载当前用户最近 N 条通知（按时间降序）。
 */
export async function preloadNotifications(meId, limit = 500) {
    if (!meId) return [];
    try {
        const rows = await loadRecentNotificationsFromCache(meId, limit);
        return rows || [];
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[localNotificationCacheService] preloadNotifications error', e);
        return [];
    }
}

/**
 * 将新收到的一批通知写入本地缓存（去重由业务组件控制）。
 */
export async function cacheNotifications(meId, notifications, limitPerUser = 500) {
    if (!meId || !Array.isArray(notifications) || notifications.length === 0) return;
    try {
        await saveNotificationsToCache(meId, notifications, limitPerUser);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[localNotificationCacheService] cacheNotifications error', e);
    }
}

/**
 * 暴露 key 构造函数，供业务按需使用。
 */
export function buildNotificationCacheKey(meId, n) {
    return buildNotificationKey(meId, n);
}