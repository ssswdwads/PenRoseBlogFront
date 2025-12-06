import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/common/ArticleCard.css';
import resolveUrl from '../../utils/resolveUrl';

function truncateByUnits(text = '', limitUnits = 48) {
    let units = 0;
    let out = '';
    for (const ch of text) {
        const code = ch.codePointAt(0);
        const isAscii = code <= 0x007f;
        const add = isAscii ? 1 : 2;
        if (units + add > limitUnits) break;
        units += add;
        out += ch;
    }
    return out;
}

export default function ArticleCard({ post, className }) {
    const [views, setViews] = useState(null);

    const coverSrc = resolveUrl(post.coverImageUrl) || null;
    const avatar = post.authorAvatarUrl || post.avatarUrl;
    const author = post.authorNickname || post.authorName || post.author || post.username || '匿名';
    const created = post.createdAt || post.created || post.createTime;
    const likeCount = post.likeCount || post.likes || 0;
    const commentCount = post.commentCount || post.comments || 0;
    const id = post.id || post.postId;

    const currentUserId =
        typeof localStorage !== 'undefined' ? localStorage.getItem('userId') : null;
    const ownerId =
        post.userId || post.authorId || post.authorUserId || post.uid || post.ownerId;
    const isOwner =
        ownerId && currentUserId && String(ownerId) === String(currentUserId);

    // 加载当前文章的浏览量
    useEffect(() => {
        let mounted = true;
        if (!id) { setViews(0); return; }
        fetch(`/api/blogview/${id}`)
            .then(r => r.ok ? r.json() : null)
            .then(j => {
                if (!mounted) return;
                if (j && j.code === 200 && j.data) setViews(Number(j.data.viewCount || 0));
                else setViews(0);
            })
            .catch(() => { if (mounted) setViews(0); });

        const onUpdate = (e) => {
            try {
                const d = e?.detail || {};
                if (String(d.blogPostId) === String(id) && d.viewCount != null) {
                    setViews(Number(d.viewCount));
                }
            } catch {}
        };
        window.addEventListener('blogview-updated', onUpdate);
        return () => { mounted = false; window.removeEventListener('blogview-updated', onUpdate); };
    }, [id]);

    const rawContent = post.content || post.summary || '';
    const preview = truncateByUnits(
        // 去除简单 Markdown 标记后再截断
        String(rawContent).replace(/[#>*`~\-!\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim(),
        48
    );

    const handleDeleteFromCard = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentUserId) {
            // eslint-disable-next-line no-alert
            alert('请先登录');
            return;
        }
        if (!isOwner) {
            // eslint-disable-next-line no-alert
            alert('只有作者本人可以删除该博客');
            return;
        }
        // eslint-disable-next-line no-alert
        const ok = window.confirm('确定要删除这篇博客吗？此操作不可恢复！');
        if (!ok) return;
        try {
            const res = await fetch(`/api/blogpost/${id}?userId=${currentUserId}`, {
                method: 'DELETE',
            });
            const j = await res.json().catch(() => null);
            if (j && j.code === 200 && j.data) {
                // eslint-disable-next-line no-alert
                alert('删除成功');
                // 简单做法：刷新列表
                window.location.reload();
            } else {
                // eslint-disable-next-line no-alert
                alert((j && (j.message || j.msg)) || '删除失败');
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[删除博客失败]', err);
            // eslint-disable-next-line no-alert
            alert('删除失败，网络错误');
        }
    };

    const card = (
        <div
            className={['home-article-card', className].filter(Boolean).join(' ')}
            style={{ position: 'relative' }}
        >
            {isOwner && (
                <button
                    type="button"
                    onClick={handleDeleteFromCard}
                    style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        backgroundColor: '#dc2626',
                        color: '#fff',
                        border: 'none',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                        zIndex: 2,
                    }}
                >
                    删除
                </button>
            )}
            <div className="home-article-content">
                <div className="home-article-title">{post.title}</div>
                <div className="home-article-preview">{preview}</div>
                <div className="home-article-footer">
                    {avatar && <img
                        src={avatar}
                        alt="author"
                        className="home-article-author-avatar"
                        style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', display: 'inline-block' }}
                    />}
                    <span>{author}</span>
                    {created && <span style={{ color:'#9aa3b2' }}>{new Date(created).toLocaleDateString()}</span>}
                    {/* 阅读量展示：位于点赞评论左侧 */}
                    <span className="home-article-views" title="阅读量">👁️ {views !== null ? views : '—'}</span>
                    <div className="home-article-meta">👍 {likeCount}　💬 {commentCount}</div>
                </div>
            </div>
            {coverSrc ? <img src={coverSrc} alt="cover" className="home-article-cover" /> : <div />}
        </div>
    );

    // 保留 Link 包裹以处理导航；删除卡片内部的重复 navigate 调用
    return (
        <Link to={`/post/${post.id || post.postId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            {card}
        </Link>
    );

}