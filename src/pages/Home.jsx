import React, { useEffect, useState } from 'react';
import Maid from '../components/common/maid/Maid';
import '../styles/home/Home.css';
import BannerNavbar from '../components/common/BannerNavbar';
import ArticleCard from '../components/common/ArticleCard';
import resolveUrl from '../utils/resolveUrl';

const Home = () => {
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(0);
  const [sortMode, setSortMode] = useState('latest'); // 'latest' | 'hot'
  const size = 5; // 每页 5 篇
  const userId = localStorage.getItem('userId');

  // totalCount 仅用于可能的前端分页界限（非必须）
  const [totalCount, setTotalCount] = useState(null);
  // 记录最近一次请求返回的条数，用于在没有 total 时判断是否有下一页
  const [lastFetchedCount, setLastFetchedCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    // 当为 hot 模式时，我们尝试拉取尽可能多的文章到前端进行全局排序。
    // 设一个较大的 fetchSize（根据项目规模可调）。
    const fetchAllForHot = sortMode === 'hot';
    const fetchSize = fetchAllForHot ? 10000 : size;
    const fetchPage = fetchAllForHot ? 0 : page;

    fetch(`/api/blogpost?page=${fetchPage}&size=${fetchSize}${userId?`&currentUserId=${userId}`:''}`)
      .then(r => r.json())
      .then(async j => {
        if (!mounted) return;
        if (j && (j.code === 200 || j.status === 200)) {
          let list = j.data && j.data.list ? j.data.list : (j.data || []);
          if (!Array.isArray(list) && Array.isArray(j.data)) list = j.data;

          if (fetchAllForHot && list.length) {
            try {
              // 并行获取所有文章的浏览量并按自定义热度排序（view + like*30）
              const ids = list.map(p => (p.id || p.postId));
              const promises = ids.map(id =>
                fetch(`/api/blogview/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
              );
              const results = await Promise.all(promises);
              const viewMap = new Map();
              results.forEach((res, idx) => {
                const id = ids[idx];
                const v = (res && res.code === 200 && res.data) ? Number(res.data.viewCount || 0) : 0;
                viewMap.set(String(id), v);
              });
              list = list.slice().sort((a, b) => {
                const va = (viewMap.get(String(a.id || a.postId)) || 0) + ((a.likeCount || a.likes || 0) * 30);
                const vb = (viewMap.get(String(b.id || b.postId)) || 0) + ((b.likeCount || b.likes || 0) * 30);
                return vb - va;
              });
            } catch (e) {
              console.error('[hot排序] 获取浏览量失败', e);
            }

            // 记录总条数，并在前端做分页切片展示
            setTotalCount(list.length);
            const start = page * size;
            const paged = list.slice(start, start + size);
            setPosts(paged);
            setLastFetchedCount(paged.length);
          } else {
            // 非 hot 模式或后端已返回已排好序的列表（分页） -> 直接使用后端返回的这一页
            setPosts(list);
            setLastFetchedCount(list.length);
            // 若后端返回 total/分页信息，可在这里设置 totalCount（容错处理）
            if (j.data && typeof j.data.total === 'number') {
              setTotalCount(j.data.total);
            } else if (!fetchAllForHot) {
              // 如果后端没有 total 字段，我们无法精确计算总页数，这里设为 null
              setTotalCount(null);
            }
          }
        } else {
          setPosts([]);
          setTotalCount(null);
          setLastFetchedCount(0);
        }
      })
      .catch(err => {
        console.error('[Home] 获取文章失败', err);
        if (mounted) {
          setPosts([]);
          setTotalCount(null);
          setLastFetchedCount(0);
        }
      });

    return () => { mounted = false; };
  }, [page, size, userId, sortMode]);

  const featured = posts && posts.length ? posts[0] : null;
  const rest = posts && posts.length ? posts.slice(1) : [];

  // 分页控制判断：若后端提供 total 则用 total 判断，否则用 lastFetchedCount === size 推断是否还有下一页
  const canPrev = page > 0;
  const canNext = totalCount !== null
    ? ((page + 1) * size < totalCount)
    : (lastFetchedCount === size);

  return (
    <>
      <BannerNavbar bannerId={undefined} />
      <div className="home-main-full">
        <div className="home-articles-container">
          <div className="home-articles-title-out">
            <div className="home-sort-group" role="tablist" aria-label="文章排序">
              <button
                className={`home-sort-btn${sortMode === 'latest' ? ' active' : ''}`}
                onClick={() => { setSortMode('latest'); setPage(0); }}
                aria-pressed={sortMode === 'latest'}
              >
                最新文章
              </button>
              <button
                className={`home-sort-btn${sortMode === 'hot' ? ' active' : ''}`}
                onClick={() => { setSortMode('hot'); setPage(0); }}
                aria-pressed={sortMode === 'hot'}
              >
                最热文章
              </button>
            </div>
          </div>
          <div className="home-articles-list">
            {posts.length === 0 ? (
              <div className="home-articles-empty">暂无文章</div>
            ) : (
              <>
                {featured && (
                  <ArticleCard key={featured.id} post={featured} className="home-article-card" />
                )}
                {rest.map(p => (
                  <ArticleCard key={p.id} post={p} className="home-article-card" />
                ))}
              </>
            )}
          </div>
          <div className="home-pagination">
            <button disabled={!canPrev} onClick={() => canPrev && setPage(Math.max(0, page - 1))}>上一页</button>
            <span>第 {page + 1} 页</span>
            <button disabled={!canNext} onClick={() => canNext && setPage(page + 1)}>下一页</button>
          </div>
        </div>
      </div>
      <Maid />
    </>
  );
};

export default Home;