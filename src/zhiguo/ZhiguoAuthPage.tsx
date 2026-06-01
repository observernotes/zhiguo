import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { PRODUCT_NAME } from '../constants/product';
import ZhiguoAvatar from './ZhiguoAvatar';

type Mode = 'login' | 'register';

export default function ZhiguoAuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setErrorMessage('');

      if (!username.trim() || !password) {
        setErrorMessage('请填写用户名和密码');
        return;
      }

      if (mode === 'register') {
        if (password !== confirmPassword) {
          setErrorMessage('两次输入的密码不一致');
          return;
        }
        if (password.length < 6) {
          setErrorMessage('密码至少 6 位');
          return;
        }
      }

      setIsSubmitting(true);
      const result =
        mode === 'login'
          ? await login(username.trim(), password)
          : await register(username.trim(), password);

      if (!result.success) {
        setErrorMessage(result.error || '操作失败，请重试');
      }
      setIsSubmitting(false);
    },
    [confirmPassword, login, mode, password, register, username],
  );

  return (
    <div className="native-safe-top native-safe-bottom flex min-h-[100dvh] items-center justify-center bg-[#FFF7ED] bg-[radial-gradient(circle_at_top,#FFE8D6_0%,#FFF7ED_38%,#FFFDF8_100%)] p-4">
      <div className="w-full max-w-md rounded-[32px] border border-orange-100/80 bg-white/90 p-8 shadow-2xl shadow-orange-100/70 backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mb-5 flex justify-center">
            <ZhiguoAvatar size="xl" ring />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#2B1A12]">{PRODUCT_NAME}</h1>
          <p className="mt-2 text-sm leading-6 text-[#8A5A44]">像聊天一样使用 AI，帮你处理日常问题</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-[#FFF0E4] p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-xl py-2 text-sm font-medium transition-colors ${
              mode === 'login' ? 'bg-white text-[#FF6B35] shadow-sm' : 'text-[#9A6A55]'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`rounded-xl py-2 text-sm font-medium transition-colors ${
              mode === 'register' ? 'bg-white text-[#FF6B35] shadow-sm' : 'text-[#9A6A55]'
            }`}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#5A3A2A]">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-orange-100 bg-[#FFF8F0] px-4 py-3 text-sm text-[#2B1A12] outline-none ring-orange-200 placeholder:text-[#C09A85] focus:bg-white focus:ring-2"
              placeholder="请输入用户名"
              autoComplete="username"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#5A3A2A]">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-orange-100 bg-[#FFF8F0] px-4 py-3 text-sm text-[#2B1A12] outline-none ring-orange-200 placeholder:text-[#C09A85] focus:bg-white focus:ring-2"
              placeholder="请输入密码"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              disabled={isSubmitting}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#5A3A2A]">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-2xl border border-orange-100 bg-[#FFF8F0] px-4 py-3 text-sm text-[#2B1A12] outline-none ring-orange-200 placeholder:text-[#C09A85] focus:bg-white focus:ring-2"
                placeholder="再次输入密码"
                autoComplete="new-password"
                disabled={isSubmitting}
              />
            </div>
          )}

          {errorMessage && (
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-[#FF6B35] py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200/80 transition hover:bg-[#F15F2B] active:scale-[0.99] disabled:opacity-60"
          >
            {isSubmitting ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}
          </button>
        </form>

        {mode === 'register' && (
          <p className="mt-4 text-center text-xs text-gray-400">
            注册后将为你创建专属文件夹，对话内容保存在本机
          </p>
        )}
      </div>
    </div>
  );
}
