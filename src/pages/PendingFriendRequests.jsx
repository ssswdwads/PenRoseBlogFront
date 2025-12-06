import React, { useEffect, useRef, useState, useMemo } from 'react';
import '../styles/message/MessageList.css';
import '../styles/Notification/PendingFriendRequests.css';
import BannerNavbar from '../components/common/BannerNavbar';
import resolveUrl from '../utils/resolveUrl';
import {
    preloadNotifications,
    cacheNotifications,
    deleteNotificationFromCache, 
} from '../utils/localNotificationCacheService';
import { ensureCommentPreview } from '../utils/commentPreviewService';

/* helper functions kept as before */
function buildKeyFromNotification(n) {
    if (!n) return '';
    const t = n.type || 'UNKNOWN';
    // 针对点赞类，加入 senderId
    if (['POST_LIKE', 'COMMENT_LIKE', 'REPLY_LIKE'].includes(t)) {
        const rid = n.referenceId ?? '0';
        const sid = n.senderId ?? '0';
        return `${t}#${rid}#${sid}`;
    }
    const rid = n.requestId ?? n.referenceId ?? '0';
    return `${t}#${rid}`;
}

function mapFriendRequestDTOToNotification(fr) {
    if (!fr) return null;

    // 支持后端推送时仅提供 requestId 的情况
    const id = fr.id ?? fr.requestId ?? null;

    // 归一化 createdAt 为数字时间戳（毫秒）
    let created = null;
    if (fr.createdAt != null) {
        created = typeof fr.createdAt === 'number' ? fr.createdAt : new Date(fr.createdAt).getTime();
        if (Number.isNaN(created)) created = null;
    }

    // 兼容多种字段命名：直接字段或嵌套 sender.*
    const senderId = fr.senderId ?? (fr.sender && fr.sender.id) ?? null;
    const senderNickname = fr.senderNickname
        ?? (fr.sender && (fr.sender.nickname || fr.sender.username))
        ?? fr.senderUsername
        ?? '';
    const senderAvatarUrl = fr.senderAvatarUrl
        ?? (fr.sender && fr.sender.avatarUrl)
        ?? '';

    const receiverId = fr.receiverId ?? (fr.receiver && fr.receiver.id) ?? fr.targetId ?? null;
    const status = fr.status ?? 'PENDING';
    const message = fr.message || '新的好友申请';

    // 如果没有 id，则无法生成带按钮的卡片，直接回退但仍返回通知
    return {
        type: 'FRIEND_REQUEST',
        requestId: id,                // 用于去重与键
        senderId,
        receiverId,
        message,
        status,
        createdAt: created,
        _friendRequestId: id,         // 控制“接受/拒绝”按钮显示
        _senderNickname: senderNickname,
        _senderAvatarUrl: senderAvatarUrl,
    };
}

// 新增：对单条好友请求进行资料补全（从 /api/friends/pending 中就地合并）
async function enrichFriendRequestFromPending(mapped, headers) {
    if (!mapped || !mapped._friendRequestId) return mapped;
    try {
        const res = await fetch('/api/friends/pending', { headers });
        const j = await res.json().catch(() => null);
        if (!j || j.code !== 200) return mapped;
        const rawList = j.data?.list || j.data || [];
        const found = (Array.isArray(rawList) ? rawList : []).find(x => {
            const xid = x.id ?? x.requestId;
            return xid != null && String(xid) === String(mapped._friendRequestId);
        });
        if (!found) return mapped;
        const enriched = mapFriendRequestDTOToNotification(found);
        if (!enriched) return mapped;
        // 合并 enrich 到已有的 mapped
        return {
            ...mapped,
            _senderNickname: enriched._senderNickname || mapped._senderNickname,
            _senderAvatarUrl: enriched._senderAvatarUrl || mapped._senderAvatarUrl,
            message: enriched.message || mapped.message,
            createdAt: mapped.createdAt ?? enriched.createdAt,
            senderId: mapped.senderId ?? enriched.senderId,
        };
    } catch {
        return mapped;
    }
}

function formatTitle(item) {
    switch (item.type) {
        case 'FRIEND_REQUEST':
            return '新的好友申请';
        case 'FRIEND_REQUEST_RESPONSE':
            return item.status === 'ACCEPTED' ? '好友申请已通过' : '好友申请被拒绝';
        case 'POST_LIKE':
            return '文章获得点赞';
        case 'COMMENT_REPLY': {
            const preview = item._commentPreview || null;
            if (preview) {
                if (preview.replyId) {
                    return '评论收到回复';
                }
                return '文章收到回复';
            }
            return '评论收到回复';
        }
        case 'COMMENT_LIKE':
            return '评论获得点赞';
        case 'REPLY_LIKE':
            return '回复获得点赞';
        case 'PRIVATE_MESSAGE':
            return '新的私信';
        default:
            return item.type || '通知';
    }
}

function gotoTarget(item) {
    if (!item) return;
    const origin = window.location.origin || '';

    switch (item.type) {
        case 'FRIEND_REQUEST':
        case 'FRIEND_REQUEST_RESPONSE':
            window.location.href = `${origin}/friends`; // 统一跳转到好友页
            break;
        case 'POST_LIKE':
            if (item.referenceId) {
                window.location.href = `${origin}/post/${item.referenceId}`;
            }
            break;
        case 'COMMENT_LIKE':
        case 'COMMENT_REPLY':
        case 'REPLY_LIKE': {
            const preview = item._commentPreview;
            if (preview && preview.postId) {
                if (preview.replyId && preview.commentId) {
                    window.location.href = `${origin}/post/${preview.postId}?commentId=${preview.commentId}&replyId=${preview.replyId}`;
                } else if (preview.commentId) {
                    window.location.href = `${origin}/post/${preview.postId}?commentId=${preview.commentId}`;
                } else {
                    window.location.href = `${origin}/post/${preview.postId}`;
                }
            } else if (item.referenceId) {
                window.location.href = `${origin}/post/${item.referenceId}`;
            }
            break;
        }
        case 'PRIVATE_MESSAGE':
            if (item.senderId) {
                window.location.href = `${origin}/conversation/${item.senderId}`;
            } else if (item.referenceId) {
                window.location.href = `${origin}/conversation/${item.referenceId}`;
            }
            break;
        default:
            break;
    }
}

export default function PendingFriendRequests() {
    const PAGE_SIZE = 6;

    const [notifications, setNotifications] = useState([]);
    const [error, setError] = useState(null);

    const token =
        typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const userId =
        typeof localStorage !== 'undefined' ? localStorage.getItem('userId') : null;

    const seenRef = useRef(new Set());
    const commentPreviewCacheRef = useRef({});

    // 三个 tab：friend | like | comment
    const [currentTab, setCurrentTab] = useState('friend');
    const [pages, setPages] = useState({ friend: 0, like: 0, comment: 0 });

    // 新增：合并策略（同 key 用新字段补全旧卡片）
    const mergeNotification = (oldItem, newItem) => {
        if (!oldItem) return newItem;
        if (!newItem) return oldItem;
        const merged = { ...oldItem };
        for (const [k, v] of Object.entries(newItem)) {
            if (v !== undefined && v !== null && v !== '') {
                merged[k] = v;
            }
        }
        return merged;
    };

    /** ---------- 统一追加/合并通知：去重 + 覆盖补全 + 排序 ---------- */
    const appendNotifications = (items) => {
        if (!items || !items.length) return;
        setNotifications((prev) => {
            const merged = Array.isArray(prev) ? prev.slice() : [];
            // 先建立索引，便于 upsert
            const indexMap = new Map();
            for (let i = 0; i < merged.length; i += 1) {
                const k = buildKeyFromNotification(merged[i]);
                if (k) indexMap.set(k, i);
            }

            for (const n of items) {
                if (!n) continue;
                const key = buildKeyFromNotification(n);
                if (!key) continue;

                if (indexMap.has(key)) {
                    // 已存在：进行“覆盖补全”合并
                    const idx = indexMap.get(key);
                    merged[idx] = mergeNotification(merged[idx], n);
                } else {
                    // 不存在：新增并记录 key
                    indexMap.set(key, merged.length);
                    merged.push(n);
                    seenRef.current.add(key);
                }
            }

            merged.sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
            });
            return merged;
        });
    };

    /** ---------- 1. 首次挂载：预加载历史通知（从 IndexedDB） ---------- */
    useEffect(() => {
        if (!userId) {
            setError('未登录');
            return;
        }

        let cancelled = false;

        (async () => {
            const cached = await preloadNotifications(userId, 500);
            if (cancelled) return;

            const filteredCached = Array.isArray(cached) ? cached.filter(n => !(n && n.type === 'PRIVATE_MESSAGE')) : [];

            if (Array.isArray(filteredCached) && filteredCached.length > 0) {
                filteredCached.sort((a, b) => {
                    const ta = a.createdAt != null ? new Date(a.createdAt).getTime() : 0;
                    const tb = b.createdAt != null ? new Date(b.createdAt).getTime() : 0;
                    return tb - ta;
                });
                const keys = new Set();
                filteredCached.forEach((n) => {
                    const k = buildKeyFromNotification(n);
                    if (k) keys.add(k);
                });
                seenRef.current = keys;
                setNotifications(filteredCached);
            } else {
                setNotifications([]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [userId]);

    /** ---------- 2. 拉好友请求 + SSE ---------- */
    useEffect(() => {
        if (!userId && !token) {
            setError('未登录');
            return;
        }

        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (userId) headers['X-User-Id'] = userId;

        const fetchPending = async () => {
            try {
                const res = await fetch('/api/friends/pending', { headers });
                const j = await res.json();
                if (j && j.code === 200) {
                    const rawList = j.data?.list || j.data || [];
                    const mapped = (Array.isArray(rawList) ? rawList : [])
                        .map(mapFriendRequestDTOToNotification)
                        .filter(Boolean);
                    // 过滤掉系统用户或无 senderId 的记录，避免占位无操作的卡片
                    const filtered = mapped.filter(n => n.senderId && n._senderNickname && n._senderNickname !== '系统');
                    if (filtered.length) {
                        appendNotifications(filtered);           // 这里会“覆盖补全”缓存中的占位卡片
                        cacheNotifications(userId, filtered, 500); // 同时把补全后的数据回写缓存
                    }
                    setError(null);
                } else {
                    setError((j && (j.message || j.msg)) || '获取好友请求失败');
                }
            } catch {
                setError('网络错误');
            }
        };

        fetchPending();

        let es = null;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : `?token=`;
        try {
            es = new EventSource(`/api/friends/subscribe${tokenParam}`);
        } catch {
            es = null;
        }

        const handleInit = async (e) => {
            try {
                const data = JSON.parse(e.data || '[]');
                let list = [];
                if (Array.isArray(data)) list = data;
                else if (data && Array.isArray(data.data)) list = data.data;
                const mapped = (Array.isArray(list) ? list : [])
                    .map(mapFriendRequestDTOToNotification)
                    .filter(Boolean);
                const filtered = mapped.filter(n => n.senderId && n._senderNickname && n._senderNickname !== '系统');
                if (filtered.length) {
                    appendNotifications(filtered);
                    cacheNotifications(userId, filtered, 500);
                }
            } catch {
                // ignore
            }
        };

        const handleNotification = async (e) => {
            try {
                const data = JSON.parse(e.data || '{}');
                if (!data) return;
                if (data.type === 'PRIVATE_MESSAGE') return;
                if (
                    data.receiverId != null &&
                    userId &&
                    String(data.receiverId) !== String(userId)
                ) {
                    return;
                }

                // 标准化通知对象
                let item = data;

                if (data.type === 'FRIEND_REQUEST') {
                    let mapped = mapFriendRequestDTOToNotification(data);
                    if (!mapped) return;

                    // 若缺少昵称/头像，则先从 /api/friends/pending 补全，再渲染，避免占位卡片
                    if (!mapped._senderNickname || !mapped._senderAvatarUrl) {
                        mapped = await enrichFriendRequestFromPending(mapped, headers);
                    }

                    item = mapped;
                } else if (
                    data.type === 'COMMENT_REPLY' ||
                    data.type === 'COMMENT_LIKE' ||
                    data.type === 'REPLY_LIKE'
                ) {
                    await ensureCommentPreview(data, headers, commentPreviewCacheRef);
                    item = { ...data, ...(data._commentPreview ? { _commentPreview: data._commentPreview } : {}) };
                } else {
                    item = data;
                }

                // 过滤系统或无效项
                if (item.type === 'FRIEND_REQUEST' && (!item.senderId || !item._friendRequestId)) {
                    // 没有 sender 或没有 requestId/id，不显示以避免占位无操作
                    return;
                }
                if (item._senderNickname === '系统') return;

                appendNotifications([item]);          // upsert：如果之前缓存了占位卡片，这里会被补全覆盖
                cacheNotifications(userId, [item], 500);
            } catch {
                // ignore
            }
        };

        const handleMessage = (e) => {
            try {
                const data = JSON.parse(e.data || '[]');
                if (Array.isArray(data)) {
                    const filteredRaw = data.filter(n => !(n && n.type === 'PRIVATE_MESSAGE'));
                    const mapped = filteredRaw
                        .map(mapFriendRequestDTOToNotification)
                        .filter(Boolean);
                    const filtered = mapped.filter(n => n.senderId && n._senderNickname && n._senderNickname !== '系统');
                    if (filtered.length) {
                        appendNotifications(filtered);
                        cacheNotifications(userId, filtered, 500);
                    }
                }
            } catch {
                // ignore
            }
        };

        if (es) {
            es.addEventListener('init', handleInit);
            es.addEventListener('notification', handleNotification);
            es.onmessage = handleMessage;
            es.onerror = () => {
                if (es) {
                    try {
                        es.close();
                    } catch {}
                    es = null;
                }
            };
        }

        return () => {
            if (es) {
                es.removeEventListener('init', handleInit);
                es.removeEventListener('notification', handleNotification);
                try {
                    es.close();
                } catch {}
            }
        };
    }, [token, userId]);

    /** ---------- 3. 好友请求响应 ---------- */
    const respond = async (friendRequestId, accept) => {
        if (!friendRequestId) return;
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (userId) headers['X-User-Id'] = userId;

        try {
            const res = await fetch(
                `/api/friends/respond/${friendRequestId}?accept=${accept}`,
                { method: 'POST', headers }
            );
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                setNotifications((prev) =>
                    prev.filter((n) => n._friendRequestId !== friendRequestId),
                );

                try {
                    await deleteNotificationFromCache(userId, { type: 'FRIEND_REQUEST', requestId: friendRequestId });
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('[PendingFriendRequests] delete cache failed', e);
                }
            } else {
                // eslint-disable-next-line no-alert
                alert((j && (j.message || j.msg)) || '处理失败');
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            // eslint-disable-next-line no-alert
            alert('网络错误');
        }
    };

    /* ---- 分类型过滤（使用 useMemo 提高性能） ---- */
    const friendNotifications = useMemo(
        () => notifications.filter(n => n && (n.type === 'FRIEND_REQUEST' || n.type === 'FRIEND_REQUEST_RESPONSE')),
        [notifications]
    );
    const likeNotifications = useMemo(
        () => notifications.filter(n => n && ['POST_LIKE','COMMENT_LIKE','REPLY_LIKE'].includes(n.type)),
        [notifications]
    );
    const commentNotifications = useMemo(
        () => notifications.filter(n => n && n.type === 'COMMENT_REPLY'),
        [notifications]
    );

    const currentList = useMemo(() => {
        if (currentTab === 'friend') return friendNotifications;
        if (currentTab === 'like') return likeNotifications;
        return commentNotifications;
    }, [currentTab, friendNotifications, likeNotifications, commentNotifications]);

    const currentPage = pages[currentTab] || 0;
    const totalPages = Math.max(0, Math.ceil((currentList.length || 0) / PAGE_SIZE) - 1);
    const pagedItems = currentList.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const setPageFor = (tab, p) => {
        setPages(prev => ({ ...prev, [tab]: p }));
    };

    const handleTabSwitch = (tab) => {
        setCurrentTab(tab);
    };

    /**
     * Ensure comment preview for comment-like notifications that lack it.
     * This avoids missing preview after preload / SSE.
     */
    useEffect(() => {
        if (!notifications || notifications.length === 0) return;
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (userId) headers['X-User-Id'] = userId;

        let cancelled = false;

        (async () => {
            const targets = notifications.filter(n =>
                n && ['COMMENT_REPLY', 'COMMENT_LIKE', 'REPLY_LIKE'].includes(n.type) && !n._commentPreview
            );
            if (!targets.length) return;
            for (const item of targets) {
                if (cancelled) return;
                try {
                    await ensureCommentPreview(item, headers, commentPreviewCacheRef);
                    setNotifications(prev => {
                        if (!Array.isArray(prev)) return prev;
                        return prev.map(p => {
                            if (p && buildKeyFromNotification(p) === buildKeyFromNotification(item)) {
                                return { ...p, ...(item._commentPreview ? { _commentPreview: item._commentPreview } : {}) };
                            }
                            return p;
                        });
                    });
                } catch (e) {
                    // ignore single preview failures
                }
            }
        })();

        return () => { cancelled = true; };
    }, [notifications, token, userId]);

    return (
        <div className="message-list-page pf-page">
            <BannerNavbar />
            <div className="message-list-container pf-container">
                <h2 className="message-list-title pf-title">通知</h2>

                {error && (
                    <div className="message-list-empty pf-error">
                        {error}
                    </div>
                )}

                {!error && notifications.length === 0 && (
                    <div className="message-list-empty pf-empty">暂无通知</div>
                )}

                {!error && notifications.length > 0 && (
                    <div className="pf-main">
                        <aside className="pf-left" aria-label="通知类型">
                            <button
                                className={`pf-tab-btn ${currentTab === 'friend' ? 'active' : ''}`}
                                onClick={() => handleTabSwitch('friend')}
                                aria-pressed={currentTab === 'friend'}
                            >
                                好友请求
                                <span className="pf-tab-count">{friendNotifications.length}</span>
                            </button>
                            <button
                                className={`pf-tab-btn ${currentTab === 'like' ? 'active' : ''}`}
                                onClick={() => handleTabSwitch('like')}
                                aria-pressed={currentTab === 'like'}
                            >
                                点赞
                                <span className="pf-tab-count">{likeNotifications.length}</span>
                            </button>
                            <button
                                className={`pf-tab-btn ${currentTab === 'comment' ? 'active' : ''}`}
                                onClick={() => handleTabSwitch('comment')}
                                aria-pressed={currentTab === 'comment'}
                            >
                                评论
                                <span className="pf-tab-count">{commentNotifications.length}</span>
                            </button>
                        </aside>

                        <section className="pf-center" aria-live="polite">
                            <ul className="message-list-ul pf-list">
                                {pagedItems.length === 0 && (
                                    <div className="message-list-empty pf-empty-list">本页暂无消息</div>
                                )}
                                {pagedItems.map((item) => {
                                    const key = buildKeyFromNotification(item);
                                    const title = formatTitle(item);
                                    const created = item.createdAt
                                        ? new Date(item.createdAt).toLocaleString()
                                        : '';
                                    const preview = item._commentPreview || null;

                                    const avatar =
                                        (preview && preview.avatarUrl) ||
                                        item._senderAvatarUrl ||
                                        item.senderAvatarUrl ||
                                        '/imgs/loginandwelcomepanel/1.png';

                                    const nickname =
                                        (preview && preview.nickname) ||
                                        item._senderNickname ||
                                        item.senderNickname ||
                                        item.senderUsername ||
                                        '';

                                    const isFriendRequest =
                                        item.type === 'FRIEND_REQUEST' && item._friendRequestId;
                                    const isCommentType =
                                        ['COMMENT_REPLY', 'COMMENT_LIKE', 'REPLY_LIKE'].includes(item.type);

                                    return (
                                        <li
                                            key={key}
                                            className="message-list-item pf-item"
                                            onClick={() => gotoTarget(item)}
                                        >
                                            <img
                                                src={resolveUrl(avatar)}
                                                alt="avatar"
                                                className="message-list-avatar pf-avatar"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = '/imgs/loginandwelcomepanel/1.png';
                                                }}
                                            />
                                            <div className="pf-body">
                                                <div className="message-list-nickname pf-nick">{nickname}</div>
                                                <div className="pf-title-line">{title}</div>
                                                <div className="pf-message">{item.message}</div>
                                                {created && (
                                                    <div className="pf-created">{created}</div>
                                                )}

                                                {isCommentType && preview && preview.postId && (
                                                    <div className="pf-comment-preview">
                                                        <div className="pf-comment-meta">
                                                            <img
                                                                src={resolveUrl(preview.avatarUrl)}
                                                                alt="avatar"
                                                                className="pf-preview-avatar"
                                                                onError={(e) => {
                                                                    e.target.onerror = null;
                                                                    e.target.src = '/imgs/loginandwelcomepanel/1.png';
                                                                }}
                                                            />
                                                            <span className="pf-preview-nick">{preview.nickname}</span>
                                                            {preview.createdAt && (
                                                                <span className="pf-preview-time">
                                                                    {new Date(preview.createdAt).toLocaleString()}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="pf-preview-content">
                                                            {(preview.content || '').slice(0, 80)}
                                                        </div>
                                                        {preview.postTitle && (
                                                            <div className="pf-preview-post">来自文章《{preview.postTitle}》</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {isFriendRequest && (
                                                <div
                                                    className="pf-actions"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <button
                                                        type="button"
                                                        className="pf-btn pf-accept"
                                                        onClick={() =>
                                                            respond(item._friendRequestId, true)
                                                        }
                                                    >
                                                        接受
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="pf-btn pf-reject"
                                                        onClick={() =>
                                                            respond(item._friendRequestId, false)
                                                        }
                                                    >
                                                        拒绝
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>

                            <div className="pf-pagination">
                                <button
                                    className="pf-page-btn"
                                    disabled={currentPage <= 0}
                                    onClick={() => {
                                        if (currentPage > 0) setPageFor(currentTab, currentPage - 1);
                                    }}
                                >
                                    上一页
                                </button>
                                <span className="pf-page-indicator">第 {currentPage + 1} 页</span>
                                <button
                                    className="pf-page-btn"
                                    disabled={currentPage >= totalPages}
                                    onClick={() => {
                                        if (currentPage < totalPages) setPageFor(currentTab, currentPage + 1);
                                    }}
                                >
                                    下一页
                                </button>
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );

}