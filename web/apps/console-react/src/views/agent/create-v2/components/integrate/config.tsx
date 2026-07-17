import { getPublicPath } from '@/utils/config';
import { t } from '@/locales';

export const directUseItems = [
  {
    id: "web",
    title: t('integrate.web_h5_embed'),
    desc: t('integrate.web_h5_embed_desc'),
    icon: getPublicPath('/images/agent/access-h5.png'),
  },
  {
    id: "link",
    title: t('integrate.link_qr'),
    desc: t('integrate.link_qr_desc'),
    icon: getPublicPath('/images/agent/access-link.png'),
  },
  {
    id: "api",
    title: t('integrate.api_access'),
    desc: t('integrate.api_access_desc'),
    icon: getPublicPath('/images/agent/access-api.png'),
  },
];

export const externalUseItems = [
  // {
  //   id: "wechat-clone",
  //   title: "微信分身号",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <WechatOutlined className="text-green-500" />,
  // },
  // {
  //   id: "wechat-official",
  //   title: "微信公众号",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <WechatOutlined className="text-green-500" />,
  // },
  // {
  //   id: "wechat-service",
  //   title: "微信客服号",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <WechatOutlined className="text-green-500" />,
  // },
  // {
  //   id: "dingtalk",
  //   title: "钉钉机器人",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <DingdingOutlined className="text-blue-500" />,
  // },
  // {
  //   id: "douyin",
  //   title: "抖音",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <VideoCameraOutlined className="text-black" />,
  // },
  // {
  //   id: "messenger",
  //   title: "Messenger",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <MessageOutlined className="text-blue-500" />,
  // },
  // {
  //   id: "whatsapp",
  //   title: "WhatsApp",
  //   desc: "调用API接口，实现更多自定义聊天场景",
  //   icon: <WhatsAppOutlined className="text-green-500" />,
  // },
];
