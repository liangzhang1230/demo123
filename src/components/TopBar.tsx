/** 演示顶栏：三个免密演示身份一键切换（老板陈总 / 主管刘敏 / 销售王丽）＋种子状态页入口 */
import { NavLink } from 'react-router-dom';

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
    isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
  }`;

export default function TopBar() {
  return (
    <div className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-3 py-2 lg:max-w-5xl lg:px-6">
        <nav className="flex gap-1.5">
          <NavLink to="/boss" className={tab}>老板 陈总</NavLink>
          <NavLink to="/manager" className={tab}>主管 刘敏</NavLink>
          <NavLink to="/sales" className={tab}>销售 王丽</NavLink>
        </nav>
        <NavLink to="/" className="text-[11px] text-gray-400">种子状态</NavLink>
      </div>
    </div>
  );
}
