import React, { useEffect, useState } from 'react';
import Maid from '../components/common/maid/Maid';
import '../styles/home/Home.css';
import BannerNavbar from '../components/common/BannerNavbar';
import ArticleCard from '../components/common/ArticleCard';

const Home = () => {
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(0);
  const [size] = useState(10);
  const userId = localStorage.getItem('userId');

  useEffect(() => {
    fetch(`/api/blogpost?page=${page}&size=${size}${userId?`&currentUserId=${userId}`:''}`)
      .then(r=>r.json()).then(j=>{ if(j && j.code===200){ setPosts(j.data.list || []); } })
      .catch(console.error);
  }, [page, size, userId]);

  // Debug: log posts to console to inspect cover field
  useEffect(() => {
    if (posts && posts.length) console.debug('[Home] posts sample:', posts.slice(0,3));
  }, [posts]);

  // 隐藏 Home 页滚动条（不影响滚动），离开时恢复
  useEffect(() => {
    try { document.body.classList.add('hide-scrollbar'); } catch (err) { void err; }
    return () => { try { document.body.classList.remove('hide-scrollbar'); } catch (err) { void err; } };
  }, []);

  return (
    <>
      <BannerNavbar bannerId={undefined} />
      <div className="home-main-full">
        <div className="home-articles-container">
          <h2>最新文章</h2>
          <div className="home-articles-list">
            {posts.map(p => (
              <ArticleCard key={p.id} post={p} />
            ))}
          </div>
          <div style={{marginTop:16}}>
            <button onClick={() => setPage(Math.max(0, page-1))}>上一页</button>
            <span style={{margin:'0 8px'}}>第 {page+1} 页</span>
            <button onClick={() => setPage(page+1)}>下一页</button>
          </div>
        </div>
      </div>
      <Maid />
    </>
  );
};

export default Home;