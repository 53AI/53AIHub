import React, { useMemo } from 'react';

interface IconProps {
  name?: string;
  size?: number | string;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

const Icon: React.FC<IconProps> = ({ name = '', size = 18, color = 'currentColor', style, className }) => {
  const viewBox = useMemo(() => {
    if (name === 'down') {
      return "0 0 48 48";
    } else if (name === 'think') {
      return "0 0 1024 1024";
    } else if (name === 'fullscreen') {
      return "0 0 24 24";
    } else if (name === 'skill') {
      return "0 0 14 14";
    } else {
      return "0 0 48 48";
    }
  }, [name]);

  const renderIcon = () => {
    switch (name) {
      case 'download':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M6 40H42" />
            <path d="m33 23l-9 9l-9-9m8.992-17v26" />
          </g>
        );
      case 'down':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M36 18L24 30L12 18" />
        );
      case 'arrowDown':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M24 42V6m12 24L24 42L12 30"/>
        );
      case 'zoom-out':
        return (
          <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="4">
            <path d="M21 38c9.389 0 17-7.611 17-17S30.389 4 21 4S4 11.611 4 21s7.611 17 17 17Z" />
            <path strokeLinecap="round" d="M15 21h12m6.222 12.222l8.485 8.485" />
          </g>
        );
      case 'zoom-in':
        return (
          <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="4">
            <path d="M21 38c9.389 0 17-7.611 17-17S30.389 4 21 4S4 11.611 4 21s7.611 17 17 17Z" />
            <path strokeLinecap="round" d="M21 15v12m-5.984-5.984L27 21m6.222 12.222l8.485 8.485" />
          </g>
        );
      case 'copy':
        return (
          <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="4">
            <path strokeLinecap="round"
              d="M13 12.432v-4.62A2.813 2.813 0 0 1 15.813 5h24.374A2.813 2.813 0 0 1 43 7.813v24.375A2.813 2.813 0 0 1 40.188 35h-4.672" />
            <path
              d="M32.188 13H7.811A2.813 2.813 0 0 0 5 15.813v24.374A2.813 2.813 0 0 0 7.813 43h24.375A2.813 2.813 0 0 0 35 40.188V15.811A2.813 2.813 0 0 0 32.188 13Z" />
          </g>
        );
      case 'loading':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M24 4v4m10-1.32l-2 3.464M41.32 14l-3.464 2M44 24h-4m1.32 10l-3.464-2M34 41.32l-2-3.464M24 44v-4m-10 1.32l2-3.464M6.68 34l3.464-2M4 24h4M6.68 14l3.464 2M14 6.68l2 3.464" />
        );
      case 'think':
        return (
          <path
            d="M512 42.666667a128 128 0 0 1 125.866667 151.424l88.405333 51.029333a128 128 0 1 1 124.032 217.984v97.834667a128.042667 128.042667 0 1 1-124.032 217.941333l-88.405333 51.029333a128 128 0 1 1-251.733334 0.042667l-88.448-51.029333a128 128 0 1 1-123.989333-218.026667v-97.834667a128.042667 128.042667 0 1 1 123.989333-218.026666L386.133333 194.090667A128 128 0 0 1 512 42.666667z m0 768a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333z m0-512a127.488 127.488 0 0 1-83.2-30.72L339.541333 319.573333a128.042667 128.042667 0 0 1-80.384 141.354667v102.144a128.042667 128.042667 0 0 1 80.384 141.397333l89.344 51.584A127.488 127.488 0 0 1 512 725.333333c31.744 0 60.757333 11.52 83.114667 30.677334l89.386666-51.541334a128.042667 128.042667 0 0 1 80.384-141.354666v-102.186667a128.042667 128.042667 0 0 1-80.384-141.397333l-89.386666-51.541334A127.488 127.488 0 0 1 512 298.666667z m298.666667 341.333333a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333zM213.333333 640a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333z m298.666667-256a128 128 0 1 1 0 256 128 128 0 0 1 0-256z m0 85.333333a42.666667 42.666667 0 1 0 0 85.333334 42.666667 42.666667 0 0 0 0-85.333334z m298.666667-170.666666a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333zM213.333333 298.666667a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333z m298.666667-170.666667a42.666667 42.666667 0 1 0 0 85.333333 42.666667 42.666667 0 0 0 0-85.333333z"
            />
        );
      case 'refresh':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M42 8v16M6 24v16m36-16c0-9.941-8.059-18-18-18a17.95 17.95 0 0 0-12.952 5.5M6 24c0 9.941 8.059 18 18 18a17.94 17.94 0 0 0 12.5-5.048" />
        );
      case 'stop':
        return (
          <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="4">
            <path d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4S4 12.954 4 24s8.954 20 20 20Z" />
            <path strokeLinecap="round" d="M19 18v12m10-12v12" />
          </g>
        );
      case 'top':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M24 6v36M12 18L24 6l12 12" />
        );
      case 'attachment':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M24.707 9.565L9.858 24.415a9 9 0 0 0 0 12.727v0a9 9 0 0 0 12.728 0l17.678-17.677a6 6 0 0 0 0-8.486v0a6 6 0 0 0-8.486 0L14.101 28.657a3 3 0 0 0 0 4.243v0a3 3 0 0 0 4.242 0l14.85-14.85" />
        );
      case 'delete':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4S4 12.954 4 24s8.954 20 20 20Z" />
            <path strokeLinecap="round" d="M29.657 18.343L18.343 29.657m0-11.314l11.314 11.314" />
          </g>
        );
      case 'expand':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M22 42H6V26M26 6h16v16" />
        );
      case 'collapse':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"
            d="M44 20H28V4M4 28h16v16" />
        );
      case 'fullscreen':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
            <path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
            <rect width="10" height="8" x="7" y="8" rx="1"/>
          </g>
        );
      case 'close':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="m8 8l32 32M8 40L40 8"/>
        );
      case 'file':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M38 22H26a2 2 0 0 1-2-2V8"/>
            <path d="M38 22v18a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h14l12 12v4Z"/>
          </g>
        );
      case 'skill':
        return (
          // 钻石/技能图标(对齐原版 SvgIcon name="skill" 视觉)
            <path fill="none" stroke="currentColor" strokeLinejoin="round" d="M11.39 5.73L9.73 4.07c.67-.15 1.17-.75 1.17-1.47c0-.83-.68-1.51-1.51-1.51c-.72 0-1.31.5-1.47 1.17L6.27.61a.37.37 0 0 0-.53 0L4.07 2.27c.67.15 1.17.75 1.17 1.47c0 .83-.68 1.51-1.51 1.51c-.72 0-1.31-.5-1.47-1.17L.61 5.73c-.15.15-.15.39 0 .53l1.66 1.66c-.67.16-1.17.76-1.17 1.47c0 .83.68 1.51 1.51 1.51c.72 0 1.31-.5 1.47-1.17l1.66 1.66c.15.15.39.15.53 0l1.66-1.66c-.67-.15-1.18-.75-1.18-1.47c0-.83.68-1.51 1.51-1.51c.72 0 1.31.5 1.47 1.17l1.66-1.66c.15-.14.15-.38 0-.53z" strokeWidth="1" />
        );
      case 'at':
        return (
          // @ 提及图标 - 圆环 + 内部 @
          <g fill="none">
            <path d="M44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44V44C28.9886 44 33.5507 42.1735 37.0539 39.1529" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M24 32C28.4183 32 32 28.4183 32 24C32 19.5817 28.4183 16 24 16C19.5817 16 16 19.5817 16 24C16 28.4183 19.5817 32 24 32Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
            <path d="M32 24C32 27.3137 34.6863 30 38 30V30C41.3137 30 44 27.3137 44 24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M32 25V16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </g>
        );
      case 'right':
        return (
          <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M16 8l16 16l-16 16"/>
        );
      case 'horizontal':
        return (
          <path d="M6 33H42" />
        );
      case 'warning':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4S4 12.954 4 24s8.954 20 20 20Z" />
            <path d="M24 16v12m0 4v.01" />
          </g>
        );
      case 'sphere':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M24 32C35.0457 32 44 28.4183 44 24C44 19.5817 35.0457 16 24 16C12.9543 16 4 19.5817 4 24C4 28.4183 12.9543 32 24 32Z" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M32 24C32 35.0457 28.4183 44 24 44C19.5817 44 16 35.0457 16 24C16 12.9543 19.5817 4 24 4C28.4183 4 32 12.9543 32 24Z" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
          </g>
        );
      case 'code-one':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path d="M9 7L23 21L9 35" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 41L39 41" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      case 'terminal':
        return (
          <>
            <rect x="4" y="8" width="40" height="32" rx="2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
            <path d="M12 18L19 24L12 30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M23 32H36" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color, display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      {renderIcon()}
    </svg>
  );
};

Icon.displayName = 'xIcon';

export default Icon;
