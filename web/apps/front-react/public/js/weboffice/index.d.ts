/**
 * 定义用户头部其它按钮菜单
 */
interface IUserHeaderSubItemsConf {
  /**
   * 类型
   */
  type: 'export_img' | 'split_line' | 'custom';
  /**
   * 文本
   */
  text?: string;
  /**
   * 事件订阅
   */
  subscribe?: ((arg0?: any) => any) | string;
}

/**
 * 定义用户头部按钮配置
 */
interface IUserHeaderButtonConf {
  /**
   * 提示
   */
  tooltip?: string;
  /**
   * 事件订阅
   */
  subscribe?: ((arg0?: any) => any) | string;

  /**
   * 菜单项
   */
  items?: IUserHeaderSubItemsConf[];
}

/**
 * 用于保存iframe原始尺寸
 */
interface IIframeWH {
  width: string;
  height: string;
}

/**
 * 定义用户头部配置
 */
interface IUserHeadersConf {
  /**
   * 返回按钮
   */
  backBtn?: IUserHeaderButtonConf;
  /**
   * 分享按钮
   */
  shareBtn?: IUserHeaderButtonConf;
  /**
   * 其他按钮
   */
  otherMenuBtn?: IUserHeaderButtonConf;
}
interface ICommonOptions {
  /**
   * 是否显示顶部区域，头部和工具栏
   */
  isShowTopArea: boolean;
  /**
   * 是否显示头部
   */
  isShowHeader: boolean;
  /**
   * 是否需要父级全屏
   */
  isParentFullscreen: boolean;
  /**
   * 是否在iframe区域内全屏
   */
  isIframeViewFullscreen: boolean;
  /**
   * 是否在浏览器区域内全屏
   */
  isBrowserViewFullscreen: boolean;
}
/**
 * 文字自定义配置
 */
interface IWpsOptions {
  /**
   * 是否显示目录
   */
  isShowDocMap?: boolean;
  /**
   * 默认以最佳显示比例打开
   */
  isBestScale?: boolean;
  /**
   * pc-是否展示底部状态栏
   */
  isShowBottomStatusBar?: boolean;
}

/**
 * 表格自定义配置
 */
interface IEtOptions {
  /**
   * pc-是否展示底部状态栏
   */
  isShowBottomStatusBar?: boolean;
}

/**
 * pdf自定义配置
 */
interface IPDFOptions {
  isShowComment?: boolean;
  isInSafeMode?: boolean;
  /**
   * pc-是否展示底部状态栏
   */
  isShowBottomStatusBar?: boolean;
}

/**
 * 演示自定义配置
 */
interface IWppOptions {
  /**
   * pc-是否展示底部状态栏
   */
  isShowBottomStatusBar?: boolean;
}

/**
 * 数据表自定义配置
 */
 interface IDBOptions {
  /**
   * 是否显示使用反馈按钮
   */
   isShowFeedback?: boolean
}

/**
 * 定义用户通用事件订阅
 */
interface ISubscriptionsConf {
  [key: string]: any;
  /**
   * 导航事件
   */
  navigate: (arg0?: any) => any;
  /**
   * WPSWEB ready 事件
   */
  ready: (arg0?: any) => any;
  /**
   * 打印事件
   */
  print?: {
    custom?: boolean,
    subscribe: (arg0?: any) => any,
  };
  /**
   * 导出 PDF 事件
   */
  exportPdf?: (arg0?: any) => any;
}

interface ITokenData {
  token: string;
  timeout: number;
}

interface IClipboardData {
  text: string;
  html: string;
}

/**
 * 用户配置
 */
interface IConfig {
  /**
   * WPSWEB iframe 挂载点
   */
  mount?: HTMLElement;
  /**
   * url参数
   */
  url?: string;
  wpsUrl?: string; // 即将废弃
  /**
   * 头部
   */
  headers?: IUserHeadersConf;
   /**
   * 头部
   */
  mode?: 'nomal' | 'simple';
  /**
   * 通用配置
   */
  commonOptions?: ICommonOptions;
  /**
   * 文字自定义配置
   */
  wpsOptions?: IWpsOptions;
  wordOptions?: IWppOptions;
  /**
   * 表格自定义配置
   */
  etOptions?: IEtOptions;
  excelOptions?: IEtOptions;
  /**
   * 演示自定义配置
   */
  wppOptions?: IWppOptions;
  pptOptions?: IWppOptions;
  /**
   * pdf自定义配置
   */
  pdfOptions?: IPDFOptions;
  /**
   * db自定义配置
   */
  dbOptions?: IDBOptions;
  /**
   * 事件订阅
   */
  subscriptions?: ISubscriptionsConf;
  // 调试模式
  debug?: boolean;
  commandBars?: IWpsCommandBars[];
  print?: {
    custom?: boolean,
    callback?: string,
  };

  exportPdf?: {
    callback?: string,
  };

  // 获取token
  refreshToken?: TRefreshToken;

  cooperUserAttribute?: {
    isCooperUsersAvatarVisible?: boolean,
    cooperUsersColor?: [{
      userId: string | number,
      color:  string,
    }],
  };
}

// type eventConfig = {
//   eventName: cbEventNames,
// }

/** ============================= */
interface IMessage {
  eventName: string;
  msgId?: string;
  callbackId?: number;
  data?: any;
  url?: any;
  result?: any;
  error?: any;
  _self?: boolean;
  sdkInstanceId?: number
}

/**
 *  WPSWEBAPI
 */
interface IWpsWebApi {
  WpsApplication?: () => any;
}

/**
 *  工具栏
 */
interface IWpsCommandBars {
  cmbId: string;
  attributes: IWpsCommandBarAttr[] | IWpsCommandBarObjectAttr;
}

/**
 *  工具栏属性
 */
interface IWpsCommandBarAttr {
  name: string;
  value: any;
}
/**
 *  工具栏属性
 */
interface IWpsCommandBarObjectAttr {
  [propName: string]: any;
}

/**
 * D.IWPS 定义
 */

interface IWps extends IWpsCompatible {
  version: string;
  url: string;
  iframe: any;
  Enum? : any; // 即将废弃
  Events?: any; // 即将废弃
  Props?: string;
  advancedApiReady: () => Promise<any>;
  /**
   * 兼容1.x用法
   */
  ready?:() => Promise<any>;
  destroy: () => Promise<any>;
  WpsApplication?: () => any;
  WordApplication?: () => any;
  EtApplication?: () => any;
  ExcelApplication?: () => any;
  WppApplication?: () => any;
  PPTApplication?: () => any;
  PDFApplication?: () => any;
  Application?: any;
  CommonApi?: any;
  commonApiReady: () => Promise<any>;
  setToken: (tokenData: {
    token: string, timeout?: number, hasRefreshTokenConfig: boolean,
  }) => Promise<any>;
  tokenData?: { token: string } | null;
  commandBars?: IWpsCommandBars[] | null;
  iframeReady?: boolean;
  on: (eventName: string, handle: (event?: any) => void) => void;
  off: (eventName: string, handle: (event?: any) => void) => void;
  Stack?: any;
  Free?: (objId: any) => Promise<any>;
}

/**
 * 兼容1.x用法
 */
interface IWpsCompatible { 
  tabs?: {
    getTabs: () => Promise<Array<{tabKey: number, text: string}>>
    switchTab: (tabKey: number) => Promise<any>,
  }
  setCommandBars?: (args: Array<IWpsCommandBars>) => Promise<void>;
  save?: () => Promise<any>;
  ApiEvent?: {
    AddApiEventListener: (eventName: string, handle: (event?: any) => void) => void
    RemoveApiEventListener: (eventName: string, handle: (event?: any) => void) => void
  }
  executeCommandBar?: (id: string) => void
}

interface IFlag {
  advancedApiReadySended: boolean;
  advancedApiReadySendedJust: boolean;
  commonApiReadySended: boolean;
  commonApiReadySendedJust: boolean;
}

interface ICbEvent {
  refreshToken?: TRefreshToken;
}

interface IWebOfficeSDK {
  config: (conf: IConfig) => IWps | undefined;
  init: (conf: IAppConfig) => IWps | undefined;
  OfficeType: OfficeType;
}

interface IReadyEvent {
  event: string;
  callback?: (...args: any) => void;
  after?: boolean;
}

type TRefreshToken = () => ITokenData | Promise<ITokenData>;

type sendMsgToWps = (msg: IMessage) => void;
type getId = () => string;

interface IAppConfig extends IConfig { 
  appId: string;
  fileId: string | number;
  officeType: string;
  /**
   * @deprecated use token instead
   */
  fileToken?: string | ITokenData;
  token?: string | ITokenData;
  endpoint?: string;
  customArgs?: Record<string, string | number>;
  /**
   * @deprecated A config item for WebOfficeSDK.config
   */
  url?: string;
  mount?: any;
  attrAllow: string | string[];
  isListenResize?: boolean; // sdk内部是否监听resize变化，默认监听
}

type OfficeType = {
  Spreadsheet: string,
  Writer: string,
  Presentation: string,
  Pdf: string,
  Otl: string
}

export { IAppConfig, ICbEvent, IClipboardData, ICommonOptions, IConfig, IDBOptions, IEtOptions, IFlag, IIframeWH, IMessage, IPDFOptions, IReadyEvent, ISubscriptionsConf, ITokenData, IUserHeaderButtonConf, IUserHeaderSubItemsConf, IUserHeadersConf, IWebOfficeSDK, IWppOptions, IWps, IWpsCommandBarAttr, IWpsCommandBarObjectAttr, IWpsCommandBars, IWpsCompatible, IWpsOptions, IWpsWebApi, OfficeType, TRefreshToken, getId, sendMsgToWps };
