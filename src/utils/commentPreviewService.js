/**
 * COMMENT_REPLY / COMMENT_LIKE / REPLY_LIKE 预览工具：
 * - 约定：notification.referenceExtraId = 文章ID
 * - notification.referenceId 可能是：评论ID（comment）或回复ID（reply，楼中楼）
 * - 会在 notification 对象上填充 `_commentPreview` 字段，格式示例：
 *   {
 *     postId,
 *     commentId,    // 如果是 reply，则为父评论 id
 *     replyId,      // 当 preview 来源于 reply 时会有此字段
 *     content,
 *     nickname,
 *     avatarUrl,
 *     createdAt,
 *     postTitle
 *   }
 *
 * 使用方式：
 *   await ensureCommentPreview(notification, headers, cacheRef);
 */
export async function ensureCommentPreview(notification, headers = {}, cacheRef) {
    if (!notification) return;
    const refId = notification.referenceId;
    const postId = notification.referenceExtraId;
    if (!refId || !postId) return;

    // 内存缓存对象（可能包含 commentId 条目，也可能包含 `reply:${replyId}` 条目）
    const cache = (cacheRef && cacheRef.current) || {};

    // 1) 先检查是否已有缓存（支持 commentId 或 reply:id）
    if (cache[refId]) {
        notification._commentPreview = cache[refId];
        return;
    }
    if (cache[`reply:${refId}`]) {
        notification._commentPreview = cache[`reply:${refId}`];
        return;
    }

    try {
        // 2) 拉取文章下的所有评论（后端接口：/api/comment/list/{postId}）
        const params = new URLSearchParams();
        params.set('size', '10000'); // 尽量拉足够多以便定位
        const url = `/api/comment/list/${postId}?${params.toString()}`;
        const res = await fetch(url, { headers });
        const j = await res.json().catch(() => null);
        if (!j || j.code !== 200) return;

        const list = Array.isArray(j.data)
            ? j.data
            : j.data && Array.isArray(j.data.list)
                ? j.data.list
                : [];

        // 3) 尝试按 comment id 匹配（最常见）
        const c = (list || []).find((x) => String(x.id) === String(refId));
        if (c) {
            const preview = {
                postId,
                commentId: c.id,
                content: c.content || '',
                nickname: c.nickname || '',
                avatarUrl: c.avatarUrl || '',
                createdAt: c.createdAt || c.createTime || notification.createdAt,
                postTitle: j.postTitle || '',
            };
            // 缓存并写回
            cache[c.id] = preview;
            if (cacheRef) cacheRef.current = cache;
            notification._commentPreview = preview;
            return;
        }

        // 4) 如果没有找到 comment，说明 referenceId 可能是 replyId（楼中楼）。
        //    遍历评论并请求每个评论的回复列表，直到找到匹配的 reply。
        //    为避免并发浪涌，这里顺序请求并在找到后立即退出。
        for (const comment of list || []) {
            try {
                const u = `/api/comment-reply/list/${comment.id}?size=10000`;
                const r = await fetch(u, { headers });
                const jr = await r.json().catch(() => null);
                if (!jr || jr.code !== 200) continue;
                const replies = Array.isArray(jr.data)
                    ? jr.data
                    : jr.data && Array.isArray(jr.data.list)
                        ? jr.data.list
                        : [];

                const found = (replies || []).find((rep) => String(rep.id) === String(refId));
                if (found) {
                    const preview = {
                        postId,
                        commentId: comment.id,
                        replyId: found.id,
                        content: found.content || '',
                        nickname: found.nickname || found.replyToNickname || '',
                        avatarUrl: found.avatarUrl || '',
                        createdAt: found.createdAt || found.createTime || notification.createdAt,
                        postTitle: j.postTitle || (jr.postTitle || ''),
                    };
                    // 缓存两种 key：父评论 id（便于 comment 查找）和 reply:id（便于 reply 查找）
                    cache[comment.id] = cache[comment.id] || {
                        postId,
                        commentId: comment.id,
                        content: comment.content || '',
                        nickname: comment.nickname || '',
                        avatarUrl: comment.avatarUrl || '',
                        createdAt: comment.createdAt || comment.createTime || notification.createdAt,
                        postTitle: j.postTitle || '',
                    };
                    cache[`reply:${found.id}`] = preview;
                    if (cacheRef) cacheRef.current = cache;
                    notification._commentPreview = preview;
                    return;
                }
            } catch {
                // 忽略单个 reply 列表请求失败，继续下一评论
            }
        }
    } catch {
        // ignore overall failures
    }
}