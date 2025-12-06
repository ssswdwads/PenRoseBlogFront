import React, { useState } from 'react';
import BannerNavbar from '../components/common/BannerNavbar';
import FollowButton from '../components/FollowButton';
import FriendRequestButton from '../components/FriendRequestButton';
import '../styles/user/UserSearch.css';
import { Link } from 'react-router-dom';

export default function UserSearch() {
  const [mode, setMode] = useState('nickname'); // 默认优先按昵称搜索
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [followingIds, setFollowingIds] = useState(new Set());
  const [friendIds, setFriendIds] = useState(new Set());
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') : null;

  const buildHeaders = () => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (userId) headers['X-User-Id'] = userId;
    return headers;
  };

  // 统一尝试多个候选接口，取第一个返回成功的数据
  const tryFetchFirst = async (candidates, pick) => {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: buildHeaders() });
        const j = await r.json();
        if (j && (j.code === 200 || j.status === 200)) {
          const ids = pick(j);
          if (Array.isArray(ids)) return new Set(ids.map(x => Number(x)));
        }
      } catch {}
    }
    return new Set();
  };

  const refreshRelations = async () => {
    // 关注集合
    const following = await tryFetchFirst(
      ['/api/follow/following', '/api/follow/list', '/api/follow/followingIds'],
      (j) => Array.isArray(j.data) ? j.data
        : (j.data && Array.isArray(j.data.list)) ? j.data.list.map(x => x.id || x.otherId) : []
    );
    setFollowingIds(following);
    // 粉丝集合
    const followers = await tryFetchFirst(
      ['/api/follow/followers', '/api/follow/fans', '/api/follow/followerIds'],
      (j) => Array.isArray(j.data) ? j.data
        : (j.data && Array.isArray(j.data.list)) ? j.data.list.map(x => x.id || x.otherId) : []
    );
    // 互相关注=好友（前端计算交集）
    const inter = new Set();
    followers.forEach(id => { if (following.has(Number(id))) inter.add(Number(id)); });
    setFriendIds(inter);
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set(mode, keyword.trim());
    try {
      const res = await fetch(`/api/users/search?${params.toString()}`);
      const j = await res.json();
      if (j && j.code === 200 && j.data) {
        setResults(j.data.list || []);
        setError(null);
      } else {
        setResults([]);
        setError(j?.message || '搜索失败');
      }
    } catch {
      setResults([]);
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="user-search-page">
      <BannerNavbar />
      <div className="user-search-container">
        <h2>查找好友</h2>
        <div className="user-search-controls">
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="username">按用户名</option>
            <option value="nickname">按昵称</option>
          </select>
          <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={mode === 'username' ? '输入用户名' : '输入昵称'} />
          <button onClick={doSearch} disabled={loading}>{loading ? '搜索中...' : '搜索'}</button>
        </div>
        <ul className="user-search-results">
          {error ? (
            <li className="empty" style={{color:'red'}}>{error}</li>
          ) : results.length === 0 ? (
            <li className="empty">没有找到用户</li>
          ) : (
            results.map(u => (
              <li key={u.id} className="user-item">
                <img
                  src={u.avatarUrl || '/public/default-avatar.png'}
                  alt={u.nickname || u.username}
                  title={u.nickname || u.username}
                  className="user-avatar"
                />
                <div className="user-info">
                  <div className="user-nick">{u.nickname || u.username}</div>
                  <div className="user-username">@{u.username}</div>
                </div>
                <div className="user-actions">
                  {String(u.id) !== String(localStorage.getItem('userId')) && (
                    <>
                      <FriendRequestButton
                        targetId={u.id}
                        initialFriend={friendIds.has(Number(u.id))}
                      />
                      <FollowButton
                        targetId={u.id}
                        initialFollowing={followingIds.has(Number(u.id))}
                      />
                    </>
                  )}
                  <Link to={`/selfspace?userId=${u.id}`} className="btn outline">查看</Link>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
