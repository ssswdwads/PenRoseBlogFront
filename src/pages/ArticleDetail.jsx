import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import MarkdownIt from 'markdown-it';
import BannerNavbar from '../components/common/BannerNavbar';
import '../styles/article/ArticleDetail.css';
import resolveUrl from '../utils/resolveUrl';

export default function ArticleDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [post, setPost] = useState(null);
    const [notFound, setNotFound] = useState(false); // 标记文章不存在 / 已被删除
    const [comments, setComments] = useState([]);
    // 评论分页
    const [commentsPage, setCommentsPage] = useState(1);
    const commentsPerPage = 8;
    // repliesMap: { [commentId]: [reply,...] }
    const [repliesMap, setRepliesMap] = useState({});
    // 楼中楼分页 map：{ [commentId]: pageNumber }
    const [repliesPageMap, setRepliesPageMap] = useState({});
    const repliesPerPage = 6;
    // 热门回复缓存：{ [commentId]: [reply,...] }
    const [hotRepliesMap, setHotRepliesMap] = useState({});
    // which comment's replies panel is open
    const [openReplies, setOpenReplies] = useState({});
    // per-comment reply input text
    const [replyTextMap, setReplyTextMap] = useState({});
    // 存放待提交回复的目标用户 id（按父评论 id 索引）
    const [replyMentionMap, setReplyMentionMap] = useState({});
    const [commentText, setCommentText] = useState('');
    // 父评论排序方式：'hot' 或 'time'
    const [commentsSortMode, setCommentsSortMode] = useState('time');
    const userId =
        typeof localStorage !== 'undefined'
            ? localStorage.getItem('userId')
            : null;
    const recordedRef = useRef(false); // 防止同一组件实例重复并发记录

    // NEW: 转发相关状态
    const [shareUrl, setShareUrl] = useState('');
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [copying, setCopying] = useState(false);

    // NEW: 选择好友转发弹窗
    const [showForwardFriends, setShowForwardFriends] = useState(false);
    const [friends, setFriends] = useState([]);
    const [friendsLoading, setFriendsLoading] = useState(false);
    const [friendsError, setFriendsError] = useState(null);

    const token =
        typeof localStorage !== 'undefined'
            ? localStorage.getItem('token')
            : null;

    const buildHeaders = () => {
        const h = {};
        if (token) h.Authorization = `Bearer ${token}`;
        if (userId) h['X-User-Id'] = userId;
        return h;
    };


    // ---------------- 加载文章 & 记录浏览 ----------------
    useEffect(() => {
        let cancelled = false;
        setPost(null);
        setNotFound(false); // 每次切换 id 时重置

        fetch(`/api/blogpost/${id}${userId ? `?currentUserId=${userId}` : ''}`)
            .then(async (r) => {
                const j = await r.json().catch(() => null);
                // eslint-disable-next-line no-console
                console.log('[文章详情] 后端返回数据:', j);
                if (cancelled) return { j, r };

                if (j && j.code === 200 && j.data) {
                    setPost(j.data);
                } else if (j && j.code === 404) {
                    // 后端业务 404：博客不存在 / 已删除
                    setNotFound(true);
                } else if (!j && r.status === 404) {
                    // HTTP 404 兜底
                    setNotFound(true);
                }

                return { j, r };
            })
            .then(async (wrap) => {
                if (!wrap) return;
                const { j } = wrap;
                // 只有文章存在时才记录浏览
                if (!j || j.code !== 200 || !j.data) return;

                try {
                    const SHORT_WINDOW_MS = 1000;
                    const key = `view_record_${id}`;
                    const now = Date.now();
                    const last = Number(sessionStorage.getItem(key) || 0);
                    if (last && now - last < SHORT_WINDOW_MS) {
                        // eslint-disable-next-line no-console
                        console.debug(
                            '[浏览] 短时内已记录，跳过重复记录',
                            id
                        );
                    } else if (!recordedRef.current) {
                        recordedRef.current = true;
                        sessionStorage.setItem(key, String(now));
                        const payload = { blogPostId: Number(id) };
                        if (userId) payload.userId = Number(userId);
                        const rec = await fetch('/api/blogview/record', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                        });
                        const jr = await rec.json().catch(() => null);
                        if (jr && jr.code === 200 && jr.data) {
                            const vc = Number(jr.data.viewCount || 0);
                            setPost((prev) =>
                                prev ? { ...prev, viewCount: vc } : prev
                            );
                            try {
                                window.dispatchEvent(
                                    new CustomEvent('blogview-updated', {
                                        detail: { blogPostId: String(id), viewCount: vc },
                                    })
                                );
                            } catch {
                                // ignore
                            }
                        }
                        setTimeout(() => {
                            recordedRef.current = false;
                        }, 800);
                    } else {
                        // eslint-disable-next-line no-console
                        console.debug(
                            '[浏览] 已在记录中，跳过本次重复触发',
                            id
                        );
                    }
                } catch (e) {
                    recordedRef.current = false;
                    // eslint-disable-next-line no-console
                    console.error('[记录浏览失败]', e);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    // 网络错误，这里不标记 notFound，以免误判
                }
            });

        // load comments
        loadComments();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, userId]);

    // ---------------- 评论相关 ----------------
    async function loadComments(page, size) {
        const params = new URLSearchParams();
        if (userId) params.set('currentUserId', userId);
        params.set('size', '10000');
        const url = `/api/comment/list/${id}?${params.toString()}`;
        try {
            const res = await fetch(url);
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                const list = Array.isArray(j.data)
                    ? j.data
                    : Array.isArray(j)
                        ? j
                        : j.data && Array.isArray(j.data.list)
                            ? j.data.list
                            : [];
                setComments(list || []);

                // （楼中楼统计、热门回复预览逻辑保持不变）
                try {
                    const ids = (list || [])
                        .map((c) => c.id)
                        .filter(Boolean);
                    if (ids.length) {
                        const promises = ids.map((cid) => {
                            const ps = new URLSearchParams();
                            ps.set('size', '10000');
                            if (userId) ps.set('currentUserId', userId);
                            const u = `/api/comment-reply/list/${cid}?${ps.toString()}`;
                            return fetch(u)
                                .then((r) => (r.ok ? r.json().catch(() => null) : null))
                                .catch(() => null);
                        });
                        const results = await Promise.all(promises);
                        const countMap = new Map();
                        const hotMap = {};
                        results.forEach((res2, idx) => {
                            const cid = ids[idx];
                            if (res2 && res2.code === 200) {
                                let arr = [];
                                if (Array.isArray(res2.data)) arr = res2.data;
                                else if (res2.data && Array.isArray(res2.data.list))
                                    arr = res2.data.list;
                                else if (res2.data && Array.isArray(res2.data.data))
                                    arr = res2.data.data;
                                if (Array.isArray(arr))
                                    countMap.set(String(cid), arr.length);
                                else if (
                                    res2.data &&
                                    typeof res2.data.total === 'number'
                                )
                                    countMap.set(String(cid), res2.data.total);

                                try {
                                    const parent =
                                        (list || []).find(
                                            (c) => String(c.id) === String(cid)
                                        ) || {};
                                    const parentLike = Number(parent.likeCount || 0);
                                    if (parentLike >= 2) {
                                        const threshold = Math.floor(parentLike / 2);
                                        const normalized = (arr || []).map((r) => ({
                                            ...(r || {}),
                                            likeCount: Number(
                                                r.likeCount || r.likes || 0
                                            ),
                                            createdAt: r.createdAt || r.createTime,
                                        }));
                                        const hot = (normalized || [])
                                            .filter(
                                                (rr) =>
                                                    Number(rr.likeCount || 0) >= threshold
                                            )
                                            .sort((a, b) => {
                                                const la =
                                                    Number(b.likeCount || 0) -
                                                    Number(a.likeCount || 0);
                                                if (la !== 0) return la;
                                                return (
                                                    new Date(a.createdAt).getTime() -
                                                    new Date(b.createdAt).getTime()
                                                );
                                            })
                                            .slice(0, 3);
                                        if (hot && hot.length)
                                            hotMap[String(cid)] = hot;
                                    }
                                } catch {
                                    // ignore
                                }
                            }
                        });
                        if (countMap.size) {
                            setComments((prev) =>
                                (prev || []).map((cm) => {
                                    const v = countMap.get(String(cm.id));
                                    if (typeof v === 'number')
                                        return { ...cm, replyCount: v };
                                    return cm;
                                })
                            );
                        }
                        if (Object.keys(hotMap).length) {
                            setHotRepliesMap((prev) => ({ ...prev, ...hotMap }));
                        }
                    }
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn('[loadComments] 获取回复统计失败', e);
                }
                return list || [];
            }
            return [];
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            return [];
        }
    }

    async function loadReplies(commentId) {
        if (!commentId) return [];
        try {
            const params = new URLSearchParams();
            params.set('size', '10000');
            if (userId) params.set('currentUserId', userId);
            const res = await fetch(
                `/api/comment-reply/list/${commentId}?${params.toString()}`
            );
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                let arr = [];
                let total = null;
                if (Array.isArray(j.data)) {
                    arr = j.data;
                } else if (j.data && Array.isArray(j.data.list)) {
                    arr = j.data.list;
                    total =
                        typeof j.data.total === 'number'
                            ? j.data.total
                            : arr.length;
                } else if (j.data && Array.isArray(j.data.data)) {
                    arr = j.data.data;
                }
                const normalized = (arr || []).map((r) => ({
                    ...(r || {}),
                    likedByCurrentUser: Boolean(
                        r && (r.likedByCurrentUser || r.liked)
                    ),
                    replyCount: r.replyCount || 0,
                }));
                const list = (normalized || [])
                    .slice()
                    .sort(
                        (a, b) =>
                            new Date(a.createdAt || a.createTime).getTime() -
                            new Date(b.createdAt || b.createTime).getTime()
                    );
                setRepliesMap((prev) => ({ ...prev, [commentId]: list }));

                try {
                    const parent =
                        (comments || []).find(
                            (cm) => String(cm.id) === String(commentId)
                        ) || {};
                    const parentLike = Number(parent.likeCount || 0);
                    if (parentLike >= 2) {
                        const threshold = Math.floor(parentLike / 2);
                        const normalized2 = (list || []).map((r) => ({
                            ...(r || {}),
                            likeCount: Number(
                                r.likeCount || r.likes || 0
                            ),
                            createdAt: r.createdAt || r.createTime,
                        }));
                        const hot = (normalized2 || [])
                            .filter(
                                (rr) =>
                                    Number(rr.likeCount || 0) >= threshold
                            )
                            .sort((a, b) => {
                                const la =
                                    Number(b.likeCount || 0) -
                                    Number(a.likeCount || 0);
                                if (la !== 0) return la;
                                return (
                                    new Date(a.createdAt).getTime() -
                                    new Date(b.createdAt).getTime()
                                );
                            })
                            .slice(0, 3);
                        if (hot && hot.length) {
                            setHotRepliesMap((prev) => ({
                                ...prev,
                                [commentId]: hot,
                            }));
                        } else {
                            setHotRepliesMap((prev) => {
                                const n = { ...prev };
                                delete n[commentId];
                                return n;
                            });
                        }
                    } else {
                        setHotRepliesMap((prev) => {
                            const n = { ...prev };
                            delete n[commentId];
                            return n;
                        });
                    }
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        '[loadReplies] compute hot replies failed',
                        e
                    );
                }

                setComments((prev) =>
                    prev.map((cm) => {
                        if (String(cm.id) === String(commentId)) {
                            return {
                                ...cm,
                                replyCount:
                                    typeof total === 'number'
                                        ? total
                                        : list.length || 0,
                            };
                        }
                        return cm;
                    })
                );

                return list;
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[loadReplies]', e);
        }
        return [];
    }

    async function openCommentReplyAndScroll(commentId, replyId) {
        try {
            let list = repliesMap[commentId];
            if (!Array.isArray(list) || list.length === 0) {
                list = (await loadReplies(commentId)) || [];
            }
            const idx = (list || []).findIndex((r) => String(r.id) === String(replyId));
            const pageForReply = idx >= 0 ? Math.floor(idx / repliesPerPage) + 1 : 1;
            setRepliesPageMap((prev) => ({ ...prev, [commentId]: pageForReply }));
            setOpenReplies((prev) => ({ ...prev, [commentId]: true }));

            // 统一清理旧的高亮
            try {
                clearAllHotHighlights();
            } catch {
                // ignore
            }

            // 尝试定位并高亮回复元素；做少量重试以兼容 DOM 还未渲染的情况
            const tryScrollAndHighlight = () => {
                const el = document.getElementById(`reply-${replyId}`);
                if (el) {
                    try {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } catch {}
                    addHotHighlight(el);
                    // 确保父评论不被同时高亮（修复父评论一起高亮的问题）
                    try {
                        const parentEl = document.getElementById(`comment-${commentId}`);
                        if (parentEl) parentEl.classList.remove('hot-highlight');
                    } catch {}
                    return true;
                }
                return false;
            };

            if (!tryScrollAndHighlight()) {
                // 二次尝试
                setTimeout(() => {
                    if (!tryScrollAndHighlight()) {
                        setTimeout(() => {
                            tryScrollAndHighlight();
                        }, 180);
                    }
                }, 120);
            }
        } catch (e) {
            // 出错时回退行为：先展开父评论，再尝试直接定位
            // eslint-disable-next-line no-console
            console.error('[openCommentReplyAndScroll] error', e);
            setOpenReplies((prev) => ({ ...prev, [commentId]: true }));
            setTimeout(() => {
                const el = document.getElementById(`reply-${replyId}`);
                if (el) {
                    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
                    addHotHighlight(el);
                    try {
                        const parentEl = document.getElementById(`comment-${commentId}`);
                        if (parentEl) parentEl.classList.remove('hot-highlight');
                    } catch {}
                }
            }, 200);
        }
    }

    function toggleRepliesPanel(commentId) {
        setOpenReplies((prev) => {
            const next = { ...prev, [commentId]: !prev[commentId] };
            if (next[commentId] && !repliesMap[commentId]) {
                loadReplies(commentId);
            }
            return next;
        });
    }

    function startReplyToReply(
        commentId,
        targetUserId,
        targetNickname
    ) {
        setOpenReplies((prev) => ({ ...prev, [commentId]: true }));
        setReplyTextMap((prev) => ({
            ...prev,
            [commentId]: `@${targetNickname} `,
        }));
        setReplyMentionMap((prev) => ({
            ...prev,
            [commentId]: Number(targetUserId) || prev[commentId],
        }));
        setTimeout(() => {
            const ta = document.querySelector(
                `#comment-${commentId} .reply-form-side textarea`
            );
            if (ta) ta.focus();
        }, 80);
    }

    async function handleSubmitReply(e, commentId) {
        e.preventDefault();
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        const content = (replyTextMap[commentId] || '').trim();
        if (!content) {
            // eslint-disable-next-line no-alert
            alert('请输入回复内容');
            return;
        }
        try {
            const body = {
                commentId: Number(commentId),
                userId: Number(userId),
                content,
            };
            const replyToUserId = replyMentionMap[commentId];
            if (replyToUserId) body.replyToUserId = Number(replyToUserId);
            const res = await fetch('/api/comment-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                const newReplyId =
                    j.data && (j.data.id || j.data.replyId);
                setReplyTextMap((prev) => ({
                    ...prev,
                    [commentId]: '',
                }));
                setReplyMentionMap((prev) => {
                    const n = { ...prev };
                    delete n[commentId];
                    return n;
                });

                const list =
                    (await loadReplies(commentId)) ||
                    repliesMap[commentId] ||
                    [];
                let idx = -1;
                if (newReplyId) {
                    idx = (list || []).findIndex(
                        (r) => String(r.id) === String(newReplyId)
                    );
                }
                if (idx < 0) {
                    idx = Math.max(0, (list || []).length - 1);
                }
                const pageForNew = Math.max(
                    1,
                    Math.ceil((idx + 1) / repliesPerPage)
                );
                setRepliesPageMap((prev) => ({
                    ...prev,
                    [commentId]: pageForNew,
                }));
                setOpenReplies((prev) => ({
                    ...prev,
                    [commentId]: true,
                }));

                setTimeout(() => {
                    const targetId =
                        newReplyId || (list && list[idx] && list[idx].id);
                    if (targetId) {
                        const el = document.getElementById(
                            `reply-${targetId}`
                        );
                        if (el) {
                            el.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                            });
                            el.classList.add('hot-highlight');
                            setTimeout(() => {
                                try {
                                    el.classList.remove('hot-highlight');
                                } catch {
                                    // ignore
                                }
                            }, 2600);
                            return;
                        }
                    }
                    const last = document.querySelector(
                        `#comment-${commentId} .reply-list .reply-item:last-child`
                    );
                    if (last) {
                        last.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                        });
                        last.classList.add('hot-highlight');
                        setTimeout(() => {
                            try {
                                last.classList.remove('hot-highlight');
                            } catch {
                                // ignore
                            }
                        }, 2600);
                    }
                }, 120);
            } else {
                // eslint-disable-next-line no-alert
                alert('回复失败');
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            // eslint-disable-next-line no-alert
            alert('网络错误');
        }
    }

    async function toggleCommentLike(commentId) {
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        try {
            const res = await fetch(
                `/api/comment/${commentId}/like?userId=${userId}`,
                { method: 'POST' }
            );
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                loadComments(0, 10);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
        }
    }

    async function toggleReplyLike(replyId, parentCommentId) {
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        try {
            const res = await fetch(
                `/api/comment-reply/${replyId}/like?userId=${userId}`,
                { method: 'POST' }
            );
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                await loadReplies(parentCommentId);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
        }
    }

    const handleSubmitComment = async (e) => {
        e.preventDefault();
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        const body = {
            blogPostId: Number(id),
            userId: Number(userId),
            content: commentText,
        };
        try {
            const res = await fetch('/api/blogpost/comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                const newCommentId =
                    j.data && (j.data.id || j.data.commentId);
                setCommentText('');
                try {
                    setCommentsSort('time');
                } catch {
                    setCommentsSortMode('time');
                    setCommentsPage(1);
                }
                await loadComments();
                setTimeout(() => {
                    if (newCommentId) {
                        const el = document.getElementById(
                            `comment-${newCommentId}`
                        );
                        if (el) {
                            el.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                            });
                            return;
                        }
                    }
                    const first = document.querySelector(
                        '.comments-list .comment-item'
                    );
                    if (first) {
                        first.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                        });
                    }
                }, 80);
                return;
            }
            // eslint-disable-next-line no-alert
            alert('评论失败');
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            // eslint-disable-next-line no-alert
            alert('网络错误');
        }
    };

    const toggleLike = async () => {
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        try {
            const res = await fetch(
                `/api/blogpost/${id}/like?userId=${userId}`,
                { method: 'POST' }
            );
            const j = await res.json();
            if (j && j.code === 200) {
                const r2 = await fetch(
                    `/api/blogpost/${id}?currentUserId=${userId}`
                );
                const j2 = await r2.json();
                if (j2 && j2.code === 200) setPost(j2.data);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
        }
    };

    // ----- 删除博客 -----
    const handleDeletePost = async () => {
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        // 只有作者能删，前端再做一次防御判断
        const ownerId =
            post?.userId ||
            post?.authorId ||
            post?.authorUserId ||
            post?.uid ||
            null;
        if (!ownerId || String(ownerId) !== String(userId)) {
            // eslint-disable-next-line no-alert
            alert('只有作者本人可以删除该博客');
            return;
        }
        // eslint-disable-next-line no-alert
        const ok = window.confirm('确定要删除这篇博客吗？此操作不可恢复！');
        if (!ok) return;
        try {
            const res = await fetch(`/api/blogpost/${id}?userId=${userId}`, {
                method: 'DELETE',
            });
            const j = await res.json().catch(() => null);
            if (j && j.code === 200 && j.data) {
                // eslint-disable-next-line no-alert
                alert('删除成功');
                navigate('/'); // 删除后跳回首页，你可以改成 '/selfspace' 等
            } else {
                // eslint-disable-next-line no-alert
                alert((j && (j.message || j.msg)) || '删除失败');
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[删除博客失败]', e);
            // eslint-disable-next-line no-alert
            alert('删除失败，网络错误');
        }
    };

    useEffect(() => {
        const handleScroll = () => {
            const current =
                window.scrollY ||
                document.documentElement.scrollTop ||
                0;
            if (current > 50) {
                document.documentElement.classList.add(
                    'banner-is-hidden'
                );
            } else {
                document.documentElement.classList.remove(
                    'banner-is-hidden'
                );
            }
        };
        window.addEventListener('scroll', handleScroll, {
            passive: true,
        });
        handleScroll();
        return () => {
            window.removeEventListener('scroll', handleScroll);
            document.documentElement.classList.remove(
                'banner-is-hidden'
            );
        };
    }, []);

    const totalComments = (comments || []).length;
    const commentsTotalPages = Math.max(
        1,
        Math.ceil(totalComments / commentsPerPage)
    );
    const sortedComments = (comments || [])
        .slice()
        .sort((a, b) => {
            if (commentsSortMode === 'hot') {
                const la =
                    Number(b.likeCount || 0) -
                    Number(a.likeCount || 0);
                if (la !== 0) return la;
                const ra =
                    Number(b.replyCount || 0) -
                    Number(a.replyCount || 0);
                if (ra !== 0) return ra;
                return (
                    new Date(b.createdAt || b.createTime).getTime() -
                    new Date(a.createdAt || a.createTime).getTime()
                );
            }
            return (
                new Date(b.createdAt || b.createTime).getTime() -
                new Date(a.createdAt || a.createTime).getTime()
            );
        });
    const displayedComments = sortedComments.slice(
        (commentsPage - 1) * commentsPerPage,
        commentsPage * commentsPerPage
    );

    function goCommentsPage(next) {
        const p = Math.min(Math.max(1, next), commentsTotalPages);
        setCommentsPage(p);
        setTimeout(() => {
            const el = document.querySelector('.article-comments');
            if (el)
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                });
        }, 60);
    }
    function setCommentsSort(mode) {
        setCommentsSortMode(mode);
        setCommentsPage(1);
    }

    function getDisplayedReplies(commentId) {
        const page = repliesPageMap[commentId] || 1;
        const arr = repliesMap[commentId] || [];
        const total = arr.length;
        const totalPages = Math.max(
            1,
            Math.ceil(total / repliesPerPage)
        );
        const p = Math.min(Math.max(1, page), totalPages);
        const slice = arr.slice(
            (p - 1) * repliesPerPage,
            p * repliesPerPage
        );
        return { slice, page: p, totalPages, total };
    }

    function goRepliesPage(commentId, next) {
        const arr = repliesMap[commentId] || [];
        const totalPages = Math.max(
            1,
            Math.ceil(arr.length / repliesPerPage)
        );
        const p = Math.min(Math.max(1, next), totalPages);
        setRepliesPageMap((prev) => ({ ...prev, [commentId]: p }));
        setOpenReplies((prev) => ({ ...prev, [commentId]: true }));
        setTimeout(() => {
            const el = document.querySelector(
                `#comment-${commentId} .reply-list`
            );
            if (el)
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
        }, 80);
    }

    const md = new MarkdownIt();

    // ----- 根据 URL 的 commentId 定位评论 -----
    const handledReplyRef = useRef(false);
    useEffect(() => {
        if (!comments || comments.length === 0) return;

        try {
            const search = window.location.search || '';
            const params = new URLSearchParams(search);
            const cid = params.get('commentId');
            const rid = params.get('replyId'); // 回复 id（可选）

            if (!cid) return;

            // 如果已经处理过同一条 reply，则不再重复处理（避免循环滚动）
            if (rid && handledReplyRef.current && String(handledReplyRef.current) === `${cid}:${rid}`) {
                // 已处理，直接返回
                return;
            }

            // 找出该评论在当前排序列表中的索引
            const idxInSorted = sortedComments.findIndex(
                (c) => String(c.id) === String(cid)
            );
            if (idxInSorted === -1) return;

            const targetPage =
                Math.floor(idxInSorted / commentsPerPage) + 1;
            setCommentsPage(targetPage);

            // 若带有 replyId，则使用 openCommentReplyAndScroll 定位并展开具体回复
            if (rid) {
                // 标记为已处理（以 "commentId:replyId" 形式）
                handledReplyRef.current = `${cid}:${rid}`;

                // 等待 DOM / 评论加载与页面切换稳定后调用展开滚动
                setTimeout(() => {
                    try {
                        if (typeof openCommentReplyAndScroll === 'function') {
                            openCommentReplyAndScroll(cid, rid);
                        } else {
                            const el = document.getElementById(`comment-${cid}`);
                            if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('hot-highlight');
                                setTimeout(() => {
                                    try { el.classList.remove('hot-highlight'); } catch {}
                                }, 2600);
                            }
                        }
                    } catch {
                        // ignore
                    }

                    // 调用后立刻把 URL 中的 replyId 参数移除，避免后续渲染重复触发
                    try {
                        const currentUrl = window.location.pathname + window.location.search;
                        const newParams = new URLSearchParams(window.location.search);
                        newParams.delete('replyId');
                        // 可选择同时删除 commentId 或保留 commentId；这里保留 commentId
                        const newSearch = newParams.toString();
                        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
                        window.history.replaceState(null, '', newUrl);
                    } catch {
                        // ignore
                    }
                }, 300);

                return;
            }

            // 没有 replyId 的情况：原有定位 comment 的高亮逻辑
            setTimeout(() => {
                const el = document.getElementById(`comment-${cid}`);
                if (el) {
                    el.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                    });
                    el.classList.add('hot-highlight');
                    setTimeout(() => {
                        try {
                            el.classList.remove('hot-highlight');
                        } catch {
                            // ignore
                        }
                    }, 2600);
                }
            }, 200);
        } catch {
            // ignore
        }
    }, [comments, sortedComments, commentsPerPage]);

    // ---------- 这里处理“不存在”和“加载中”两种状态 ----------

    if (notFound) {
        return (
            <div className="article-detail-page">
                <BannerNavbar />
                <div
                    style={{
                        minHeight: '60vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        color: '#555',
                    }}
                >
                    啊哦，博客消失了喵❤
                </div>
            </div>
        );
    }

    if (!post) {
        return (
            <div className="article-detail-page">
                <BannerNavbar />
                <div
                    style={{
                        minHeight: '60vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        color: '#666',
                    }}
                >
                    加载中...
                </div>
            </div>
        );
    }

    // 计算当前登录用户是否是作者
    const ownerId =
        post.userId ||
        post.authorId ||
        post.authorUserId ||
        post.uid ||
        null;
    const isOwner =
        ownerId && userId && String(ownerId) === String(userId);

    // ---------------- 转发相关前端逻辑 ----------------

    // 从后端获取当前文章用于“私信预览”的分享 URL
    const ensureShareUrl = async () => {
        if (shareUrl) return shareUrl;
        try {
            const res = await fetch(`/api/blogpost/${id}/share-url`);
            const j = await res.json().catch(() => null);
            if (j && j.code === 200 && j.data) {
                setShareUrl(j.data);
                return j.data;
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[获取分享链接失败]', e);
        }
        const fallback = window.location.href;
        setShareUrl(fallback);
        return fallback;
    };

    const handleShareClick = async () => {
        const url = await ensureShareUrl();
        if (!url) {
            // eslint-disable-next-line no-alert
            alert('暂时无法获取文章链接');
            return;
        }
        setShowShareMenu((v) => !v);
    };

    const getCopyableUrl = () => {
        try {
            const origin = window.location.origin;
            return `${origin}/post/${id}`;
        } catch {
            return window.location.href;
        }
    };

    const handleCopyLink = async () => {
        const url = getCopyableUrl();
        if (!url) {
            // eslint-disable-next-line no-alert
            alert('暂时无法获取文章链接');
            return;
        }
        setCopying(true);
        try {
            if (
                navigator.clipboard &&
                navigator.clipboard.writeText
            ) {
                await navigator.clipboard.writeText(url);
                // eslint-disable-next-line no-alert
                alert('链接已复制到剪贴板');
            } else {
                const ok = window.prompt('复制以下链接:', url);
                if (!ok && ok !== null) {
                    // ignore
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('复制失败', e);
            const ok = window.prompt('复制以下链接:', url);
            if (!ok && ok !== null) {
                // ignore
            }
        } finally {
            setCopying(false);
            setShowShareMenu(false);
        }
    };

    const openForwardFriendsDialog = async () => {
        if (!userId) {
            // eslint-disable-next-line no-alert
            alert('请先登录后再转发到私信');
            return;
        }
        setFriendsLoading(true);
        setFriendsError(null);
        setShowForwardFriends(true);
        try {
            const res = await fetch('/api/friends/list', {
                headers: buildHeaders(),
            });
            const j = await res.json().catch(() => null);
            if (j && j.code === 200) {
                setFriends(j.data?.list || j.data || []);
            } else {
                setFriendsError(
                    (j && (j.message || j.msg)) || '获取好友列表失败'
                );
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[获取好友列表失败]', e);
            setFriendsError('网络错误');
        } finally {
            setFriendsLoading(false);
        }
    };

    const handleChooseFriendToForward = async (targetUserId) => {
        if (!targetUserId) return;
        const url = await ensureShareUrl();
        if (!url) {
            // eslint-disable-next-line no-alert
            alert('暂时无法获取文章链接');
            return;
        }
        setShowForwardFriends(false);
        setShowShareMenu(false);
        navigate(
            `/conversation/${targetUserId}?text=${encodeURIComponent(
                url
            )}`
        );
    };

    return (
        <div className="article-detail-page">
            <BannerNavbar />
            <div className="article-detail-container">
                <article className="article-main">
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                        }}
                    >
                        <h1>{post.title}</h1>
                        {isOwner && (
                            <button
                                type="button"
                                onClick={handleDeletePost}
                                style={{
                                    backgroundColor: '#dc2626',
                                    color: '#fff',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                删除博客
                            </button>
                        )}
                    </div>
                    <div
                        className="article-meta"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        {post.authorAvatarUrl ? (
                            <Link
                                to={`/selfspace?userId=${
                                    post.authorId ||
                                    post.userId ||
                                    post.authorUserId ||
                                    ''
                                }`}
                                title={post.authorNickname || '用户主页'}
                            >
                                <img
                                    src={resolveUrl(post.authorAvatarUrl)}
                                    alt="avatar"
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                    }}
                                />
                            </Link>
                        ) : null}
                        <span>
                            {post.authorNickname ? post.authorNickname : '匿名'}
                        </span>
                        <span
                            style={{ color: '#bbb', marginLeft: 8 }}
                        >
                            {new Date(post.createdAt).toLocaleString()}
                        </span>
                    </div>
                    <div
                        className="article-content"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{
                            __html: md.render(post.content || ''),
                        }}
                    />

                    <div
                        className="article-actions"
                        style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                        }}
                    >
                        <button type="button" onClick={toggleLike}>
                            {post.likedByCurrentUser ? '取消点赞' : '点赞'} (
                            {post.likeCount || 0})
                        </button>

                        <div
                            style={{
                                position: 'relative',
                                display: 'inline-block',
                            }}
                        >
                            <button
                                type="button"
                                onClick={handleShareClick}
                            >
                                转发
                            </button>
                            {showShareMenu && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '110%',
                                        left: 0,
                                        zIndex: 1000,
                                        background: '#fff',
                                        border: '1px solid #ddd',
                                        borderRadius: 4,
                                        boxShadow:
                                            '0 2px 8px rgba(0,0,0,0.15)',
                                        padding: 8,
                                        minWidth: 160,
                                    }}
                                >
                                    <button
                                        type="button"
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            textAlign: 'left',
                                            marginBottom: 4,
                                        }}
                                        onClick={openForwardFriendsDialog}
                                    >
                                        转发到私信
                                    </button>
                                    <button
                                        type="button"
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            textAlign: 'left',
                                        }}
                                        disabled={copying}
                                        onClick={handleCopyLink}
                                    >
                                        {copying ? '复制中…' : '复制链接'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 评论区域 */}
                    <section className="article-comments">
                        <h3>评论</h3>
                        <form onSubmit={handleSubmitComment}>
                            {userId ? (
                                <>
                                    <label
                                        htmlFor="commentText"
                                        className="comment-hint"
                                    >
                                        在此发表评论（支持基本文本）
                                    </label>
                                    <textarea
                                        id="commentText"
                                        aria-label="发表评论"
                                        placeholder="写下你的想法，文明评论~"
                                        value={commentText}
                                        onChange={(e) =>
                                            setCommentText(e.target.value)
                                        }
                                        required
                                    />
                                    <div style={{ marginTop: 8 }}>
                                        <button type="submit">评论</button>
                                    </div>
                                </>
                            ) : (
                                <div
                                    className="comment-login-prompt"
                                    style={{ padding: 8 }}
                                >
                                    请先 <a href="/welcome">登录</a> 后发表评论。
                                </div>
                            )}
                        </form>

                        <div
                            className="sort-controls"
                            style={{
                                marginTop: 12,
                                marginBottom: 8,
                                display: 'flex',
                                gap: 12,
                                alignItems: 'center',
                            }}
                        >
                            <button
                                type="button"
                                className={`sort-button ${
                                    commentsSortMode === 'hot' ? 'active' : ''
                                }`}
                                onClick={() => setCommentsSort('hot')}
                            >
                                按热度
                            </button>
                            <button
                                type="button"
                                className={`sort-button ${
                                    commentsSortMode === 'time' ? 'active' : ''
                                }`}
                                onClick={() => setCommentsSort('time')}
                            >
                                按时间
                            </button>
                        </div>

                        <div className="comments-list">
                            {displayedComments.map((c) => (
                                <div
                                    key={c.id}
                                    id={`comment-${c.id}`}
                                    className="comment-item"
                                >
                                    <div className="comment-avatar">
                                        <Link
                                            to={`/selfspace?userId=${
                                                c.userId ||
                                                c.authorId ||
                                                c.uid ||
                                                ''
                                            }`}
                                            title={c.nickname || '用户主页'}
                                        >
                                            <img
                                                src={resolveUrl(c.avatarUrl)}
                                                alt="avatar"
                                            />
                                        </Link>
                                    </div>
                                    <div className="comment-body">
                                        <div className="comment-main">
                                            <div className="comment-header">
                                                <div className="comment-meta-top">
                                                    <span className="comment-author">
                                                        {c.nickname}
                                                    </span>
                                                    <span className="comment-time">
                                                        {' '}
                                                        ·{' '}
                                                        {new Date(
                                                            c.createdAt
                                                        ).toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="comment-content">
                                                {c.content}
                                            </div>

                                            {/* 热门回复预览 */}
                                            {!openReplies[c.id] &&
                                                hotRepliesMap[c.id] &&
                                                hotRepliesMap[c.id].length > 0 && (
                                                    <div className="hot-preview">
                                                        <div className="hot-preview-title">
                                                            热门回复预览
                                                        </div>
                                                        <div className="hot-preview-list">
                                                            {hotRepliesMap[c.id]
                                                                .slice(0, 3)
                                                                .map((hr) => (
                                                                    <a
                                                                        key={hr.id}
                                                                        href={`#reply-${hr.id}`}
                                                                        className="hot-item"
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            openCommentReplyAndScroll(
                                                                                c.id,
                                                                                hr.id
                                                                            );
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={resolveUrl(
                                                                                hr.avatarUrl
                                                                            )}
                                                                            alt={hr.nickname}
                                                                            className="hot-item-avatar"
                                                                        />
                                                                        <div className="hot-item-body">
                                                                            <div className="hot-item-nick">
                                                                                {hr.nickname}
                                                                            </div>
                                                                            <div className="hot-item-snippet">
                                                                                {(
                                                                                    hr.content || ''
                                                                                ).slice(0, 60)}
                                                                            </div>
                                                                        </div>
                                                                        <div className="hot-item-meta">
                                                                            👍
                                                                            {hr.likeCount || 0}
                                                                        </div>
                                                                    </a>
                                                                ))}
                                                        </div>
                                                    </div>
                                                )}

                                            {/* 楼中楼 */}
                                            {openReplies[c.id] && (
                                                <div className="reply-section">
                                                    <div className="reply-list">
                                                        {getDisplayedReplies(c.id).slice.map(
                                                            (r) => {
                                                                const m =
                                                                    (r.content || '').match(
                                                                        /^@([^\s]+)\s+/
                                                                    );
                                                                let mentionTargetId =
                                                                    r.replyToUserId ||
                                                                    r.replyToId ||
                                                                    null;
                                                                if (!mentionTargetId && m) {
                                                                    const nick = m[1];
                                                                    const foundInReplies = (
                                                                        repliesMap[c.id] ||
                                                                        []
                                                                    ).find(
                                                                        (rr) =>
                                                                            rr.nickname === nick
                                                                    );
                                                                    if (foundInReplies)
                                                                        mentionTargetId =
                                                                            foundInReplies.userId;
                                                                    else {
                                                                        const foundInComments = (
                                                                            comments || []
                                                                        ).find(
                                                                            (cm) =>
                                                                                cm.nickname ===
                                                                                nick
                                                                        );
                                                                        if (foundInComments)
                                                                            mentionTargetId =
                                                                                foundInComments.userId;
                                                                    }
                                                                }
                                                                return (
                                                                    <div
                                                                        key={r.id}
                                                                        id={`reply-${r.id}`}
                                                                        className="reply-item"
                                                                    >
                                                                        <div className="reply-avatar">
                                                                            <Link
                                                                                to={`/selfspace?userId=${
                                                                                    r.userId ||
                                                                                    r.authorId ||
                                                                                    r.uid ||
                                                                                    ''
                                                                                }`}
                                                                                title={
                                                                                    r.nickname ||
                                                                                    '用户主页'
                                                                                }
                                                                            >
                                                                                <img
                                                                                    src={resolveUrl(
                                                                                        r.avatarUrl
                                                                                    )}
                                                                                    alt="avatar"
                                                                                />
                                                                            </Link>
                                                                        </div>
                                                                        <div className="reply-body">
                                                                            <div className="reply-header">
                                                                                <div className="reply-meta-top">
                                                                                    {r.nickname} ·{' '}
                                                                                    {new Date(
                                                                                        r.createdAt
                                                                                    ).toLocaleString()}
                                                                                </div>
                                                                                <div className="reply-actions-below">
                                                                                    <button
                                                                                        type="button"
                                                                                        className="comment-action-btn"
                                                                                        onClick={() =>
                                                                                            toggleReplyLike(
                                                                                                r.id,
                                                                                                c.id
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        {r.likedByCurrentUser ||
                                                                                        r.liked
                                                                                            ? '取消点赞'
                                                                                            : '点赞'}{' '}
                                                                                        (
                                                                                        {r.likeCount ||
                                                                                            0}
                                                                                        )
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="comment-action-btn"
                                                                                        onClick={() =>
                                                                                            startReplyToReply(
                                                                                                c.id,
                                                                                                r.userId,
                                                                                                r.nickname
                                                                                            )
                                                                                        }
                                                                                        style={{
                                                                                            marginLeft: 6,
                                                                                        }}
                                                                                    >
                                                                                        回复
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            {m ? (
                                                                                <div className="reply-content">
                                                                                    {mentionTargetId ? (
                                                                                        <Link
                                                                                            to={`/selfspace?userId=${mentionTargetId}`}
                                                                                            className="mention-link"
                                                                                        >
                                                                                            @{m[1]}
                                                                                        </Link>
                                                                                    ) : (
                                                                                        <span className="mention-link">
                                                                                            @{m[1]}
                                                                                        </span>
                                                                                    )}
                                                                                    <span>
                                                                                        {' '}
                                                                                        {r.content.slice(
                                                                                            m[0].length
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="reply-content">
                                                                                    {r.content}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            }
                                                        )}
                                                        {(!repliesMap[c.id] ||
                                                            repliesMap[c.id].length ===
                                                            0) && (
                                                            <div className="reply-empty">
                                                                暂无回复
                                                            </div>
                                                        )}
                                                        {(repliesMap[c.id] || [])
                                                                .length > repliesPerPage &&
                                                            (() => {
                                                                const rp =
                                                                    getDisplayedReplies(
                                                                        c.id
                                                                    );
                                                                return (
                                                                    <div className="replies-pager pager">
                                                                        <button
                                                                            type="button"
                                                                            className="pager-button"
                                                                            onClick={() =>
                                                                                goRepliesPage(
                                                                                    c.id,
                                                                                    rp.page - 1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                rp.page <= 1
                                                                            }
                                                                        >
                                                                            上一页
                                                                        </button>
                                                                        <span className="pager-current">
                                                                            第 {rp.page} 页
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            className="pager-button"
                                                                            onClick={() =>
                                                                                goRepliesPage(
                                                                                    c.id,
                                                                                    rp.page + 1
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                rp.page >=
                                                                                rp.totalPages
                                                                            }
                                                                        >
                                                                            下一页
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })()}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="comment-side">
                                            <div className="comment-actions-below">
                                                <button
                                                    type="button"
                                                    className="comment-action-btn"
                                                    onClick={() => toggleCommentLike(c.id)}
                                                >
                                                    {c.likedByCurrentUser ||
                                                    c.liked
                                                        ? '取消点赞'
                                                        : '点赞'}{' '}
                                                    ({c.likeCount || 0})
                                                </button>
                                                <button
                                                    type="button"
                                                    className="comment-action-btn"
                                                    onClick={() =>
                                                        toggleRepliesPanel(c.id)
                                                    }
                                                >
                                                    {openReplies[c.id]
                                                        ? '收起'
                                                        : '回复'}{' '}
                                                    {(
                                                        c.replyCount != null
                                                            ? c.replyCount
                                                            : (repliesMap[c.id] ||
                                                                []).length
                                                    ) || 0}
                                                </button>
                                            </div>
                                            {userId && openReplies[c.id] && (
                                                <form
                                                    className="reply-form-side"
                                                    onSubmit={(e) =>
                                                        handleSubmitReply(e, c.id)
                                                    }
                                                >
                                                    <textarea
                                                        placeholder="回复…"
                                                        value={replyTextMap[c.id] || ''}
                                                        onChange={(e) =>
                                                            setReplyTextMap((prev) => ({
                                                                ...prev,
                                                                [c.id]: e.target.value,
                                                            }))
                                                        }
                                                        required
                                                    />
                                                    <div>
                                                        <button type="submit">
                                                            回复
                                                        </button>
                                                    </div>
                                                </form>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {totalComments > commentsPerPage && (
                                <div
                                    className="comments-pager pager"
                                    style={{ marginTop: 12 }}
                                >
                                    <button
                                        type="button"
                                        className="pager-button"
                                        onClick={() =>
                                            goCommentsPage(commentsPage - 1)
                                        }
                                        disabled={commentsPage <= 1}
                                    >
                                        上一页
                                    </button>
                                    <span className="pager-current">
                                        第 {commentsPage} 页
                                    </span>
                                    <button
                                        type="button"
                                        className="pager-button"
                                        onClick={() =>
                                            goCommentsPage(commentsPage + 1)
                                        }
                                        disabled={
                                            commentsPage >= commentsTotalPages
                                        }
                                    >
                                        下一页
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>
                </article>
            </div>

            {/* 好友列表弹窗，用于选择转发对象 */}
            {showForwardFriends && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        zIndex: 1500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => setShowForwardFriends(false)}
                >
                    <div
                        style={{
                            background: '#fff',
                            borderRadius: 8,
                            padding: 16,
                            maxHeight: '80vh',
                            width: '420px',
                            overflow: 'auto',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3
                            style={{ marginTop: 0, marginBottom: 12 }}
                        >
                            选择好友转发
                        </h3>
                        {friendsLoading && (
                            <div>加载好友列表中...</div>
                        )}
                        {friendsError && (
                            <div style={{ color: 'red' }}>
                                {friendsError}
                            </div>
                        )}
                        {!friendsLoading &&
                            !friendsError &&
                            friends.length === 0 && (
                                <div>暂无好友可转发</div>
                            )}
                        {!friendsLoading &&
                            !friendsError &&
                            friends.length > 0 && (
                                <ul
                                    style={{
                                        listStyle: 'none',
                                        margin: 0,
                                        padding: 0,
                                    }}
                                >
                                    {friends.map((f) => (
                                        <li
                                            key={f.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                padding: '6px 0',
                                                borderBottom:
                                                    '1px solid #f2f2f2',
                                                cursor: 'pointer',
                                            }}
                                            onClick={() =>
                                                handleChooseFriendToForward(
                                                    f.id
                                                )
                                            }
                                        >
                                            <img
                                                src={
                                                    f.avatarUrl ||
                                                    '/imgs/loginandwelcomepanel/1.png'
                                                }
                                                alt="avatar"
                                                style={{
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: '50%',
                                                    objectFit: 'cover',
                                                    marginRight: 8,
                                                }}
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src =
                                                        '/imgs/loginandwelcomepanel/1.png';
                                                }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        fontWeight: 500,
                                                    }}
                                                >
                                                    {f.nickname || f.username}
                                                </div>
                                                {f.bio && (
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            color: '#777',
                                                        }}
                                                    >
                                                        {f.bio}
                                                    </div>
                                                )}
                                            </div>
                                            <button type="button">
                                                选择
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        <div
                            style={{
                                textAlign: 'right',
                                marginTop: 12,
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setShowForwardFriends(false)}
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------- hot highlight 管理（避免重复闪动） ----------
const hotHighlightTimers = new Map();

function addHotHighlight(el) {
  if (!el) return;
  const key = el.id || `${Math.random()}`;
  // 如果已有计时器，先清除旧计时器（重置高亮时长）
  if (hotHighlightTimers.has(key)) {
    try { clearTimeout(hotHighlightTimers.get(key)); } catch {}
  }
  // 加 class（如果已存在也没关系），然后设置新的移除计时器
  try { el.classList.add('hot-highlight'); } catch {}
  const t = setTimeout(() => {
    try { el.classList.remove('hot-highlight'); } catch {}
    hotHighlightTimers.delete(key);
  }, 2600);
  hotHighlightTimers.set(key, t);
}

function clearAllHotHighlights() {
  // 清空所有计时器并移除 class
  for (const [key, t] of hotHighlightTimers.entries()) {
    try { clearTimeout(t); } catch {}
    const el = document.getElementById(key);
    if (el) {
      try { el.classList.remove('hot-highlight'); } catch {}
    }
  }
  hotHighlightTimers.clear();
}