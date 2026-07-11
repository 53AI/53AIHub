import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Avatar, Button, Input, Modal, message } from 'antd'
import { RightOutlined, CloseOutlined, WarningFilled } from '@ant-design/icons'
import { useUserStore } from '@/stores/modules/user'
import { useEnv } from '@/hooks/useEnv'
import { CropperDialog, CropperDialogRef } from '@/components/CropperDialog'
import ChangeMobile, { ChangeMobileRef } from './change-mobile'
import ResetPassword, { ResetPasswordRef } from './reset-password'
import Email, { EmailBindRef } from './email'
import WechatView from './wechat'
import userApi from '@/api/modules/user'
import enterpriseApi from '@/api/modules/enterprise'
import { Link } from 'react-router-dom'
import { t } from '@/locales'
import './profile.css'

export interface UserInfoRef {
  resetForm: () => void
}

const UserInfo = forwardRef<UserInfoRef>((_, ref) => {
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv()
  const userStore = useUserStore()

  const [dialogs, setDialogs] = useState({
    profile: false,
    email: false,
    resetPassword: false,
    changeMobile: false,
    unbindWechat: false,
    bindWechat: false
  })

  const [openSMTP, setOpenSMTP] = useState(false)
  const [profileForm, setProfileForm] = useState({
    nickname: '',
    avatar: ''
  })
  const [qrcodeRender, setQrcodeRender] = useState(true)
  const originHistoryRef = useRef(0)

  const cropperRef = useRef<CropperDialogRef>(null)
  const mobileRef = useRef<ChangeMobileRef>(null)
  const passwordRef = useRef<ResetPasswordRef>(null)
  const emailRef = useRef<EmailBindRef>(null)

  useImperativeHandle(ref, () => ({
    resetForm: () => {
      mobileRef.current?.resetForm()
      passwordRef.current?.resetForm()
      emailRef.current?.resetForm()
    }
  }))

  const resetAllForms = () => {
    mobileRef.current?.resetForm()
    passwordRef.current?.resetForm()
    emailRef.current?.resetForm()
  }

  const handleEdit = () => {
    setProfileForm({
      avatar: userStore.info.avatar,
      nickname: userStore.info.nickname
    })
    setDialogs(prev => ({ ...prev, profile: true }))
  }

  const handleChangeAvatar = () => {
    cropperRef.current?.uploadFile()
  }

  const handleSuccessCropper = (data: { url: string }) => {
    setProfileForm(prev => ({ ...prev, avatar: data.url }))
  }

  const handleSaveProfile = async () => {
    if (!profileForm.nickname.trim()) return
    await userStore.update(profileForm)
    setDialogs(prev => ({ ...prev, profile: false }))
    message.success(t('status.updated'))
  }

  const handleSuccess = (type: 'email' | 'mobile') => {
    if (type === 'email') {
      setDialogs(prev => ({ ...prev, email: false }))
    } else if (type === 'mobile') {
      setDialogs(prev => ({ ...prev, changeMobile: false }))
    }
    setTimeout(() => {
      userStore.getUserInfo()
    }, 1000)
  }

  const handleUnbindWechat = async (confirm = false) => {
    if (confirm) {
      await userApi.unbind_wechat()
      message.success(t('profile.unbind_success'))
      setTimeout(() => {
        userStore.getUserInfo()
      }, 1000)
    }
    setDialogs(prev => ({ ...prev, unbindWechat: !confirm }))
  }

  const handleBindWechat = () => {
    setDialogs(prev => ({ ...prev, bindWechat: true }))
    originHistoryRef.current = window.history.length
  }

  const handleOauthSuccess = async (data: { openid: string; unionid: string }) => {
    try {
      await userApi.bind_wechat({ openid: data.openid, unionid: data.unionid })
      message.success(t(userStore.info.openid ? 'profile.change_success' : 'profile.bind_success'))
      setDialogs(prev => ({ ...prev, bindWechat: false }))
      setTimeout(() => {
        userStore.getUserInfo()
      }, 1000)

      const backStep = originHistoryRef.current - window.history.length
      if (backStep !== 0) {
        window.history.go(backStep)
      }
    } catch (err) {
      setQrcodeRender(false)
      setTimeout(() => setQrcodeRender(true), 100)
      throw err
    }
  }

  useEffect(() => {
    const loadSMTP = async () => {
      try {
        const { data } = await enterpriseApi.getSMTPInfo('smtp')
        setOpenSMTP(data)
      } catch (error) {
        console.error('Failed to load SMTP info:', error)
      }
    }
    loadSMTP()
  }, [])

  const getPublicPath = (path: string) => path

  return (
    <div className="userinfo-container">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mt-6">
        <h2 className="text-primary font-semibold">{t('profile.info')}</h2>
        {!userStore.info.is_internal && (
          <div className="flex justify-end items-center gap-1">
            <div className="h-6 flex items-center gap-1 px-2 text-sm text-placeholder whitespace-nowrap" title={userStore.info.group_name}>
              <img
                src={!/\.png$/.test(userStore.info.group_icon)
                  ? getPublicPath(`/images/subscription/${userStore.info.group_icon}.png`)
                  : userStore.info.group_icon}
                className="w-4 h-4 object-cover"
                alt=""
              />
              <p className="max-w-[5em] truncate">{userStore.info.group_name}</p>
            </div>
            <div className="flex-none w-px h-3 bg-[#E6E8EB] mx-1" />
            <div className="text-sm text-secondary flex items-center gap-1">
              <span>{t('subscription.expire_time')}：</span>
              <span className="text-primary">{userStore.info.group_expire_time || t('profile.permanent_valid')}</span>
            </div>
          </div>
        )}
      </div>

      {/* User Card */}
      <div
        className="flex items-center gap-2 w-full p-4 box-border cursor-pointer mt-4 rounded-lg overflow-hidden bg-[#F7F7F7]"
        onClick={handleEdit}
      >
        <Avatar size={48} src={userStore.info.avatar} className="flex-none" style={{ backgroundColor: 'transparent' }} />
        <div className="flex-1 w-0">
          <div className="text-primary font-semibold">{userStore.info.nickname}</div>
          <p className="text-sm text-secondary mt-1 flex items-center gap-1">
            {userStore.info.mobile || t('common.no_description')}
          </p>
        </div>
        <RightOutlined className="text-regular" />
      </div>

      {/* Bind Accounts */}
      <div className="flex items-center justify-center">
        <h2 className="text-primary font-semibold mt-6">{t('profile.bind_accounts')}</h2>
      </div>
      <div className="flex flex-col mt-4 bg-[#F7F7F7] rounded-lg box-border overflow-hidden">
        {/* Mobile */}
        <div className="p-4 box-border flex items-center gap-2.5 account-item">
          <img className="size-6" src={getPublicPath('/images/profile/mobile.png')} alt="" />
          <div className="flex-none text-base text-primary">{t('profile.bind_mobile')}</div>
          <div className="flex-1 w-0 text-sm text-placeholder invisible md:visible">
            {userStore.info.mobile || t('profile.unbind_account')}
          </div>
          {!isOpLocalEnv && (
            <Button type="link" className="!text-[#586D9A]" onClick={() => setDialogs(prev => ({ ...prev, changeMobile: true }))}>
              {userStore.info.mobile ? t('profile.change') : t('profile.bind')}
            </Button>
          )}
        </div>

        {/* Password */}
        <div className="p-4 box-border flex items-center gap-2.5 account-item">
          <img className="size-6" src={getPublicPath('/images/profile/password.png')} alt="" />
          <div className="flex-1 w-0 text-base text-primary">{t('profile.login_password')}</div>
          {(!isOpLocalEnv || (isOpLocalEnv && openSMTP)) && (
            <Button type="link" className="!text-[#586D9A]" onClick={() => setDialogs(prev => ({ ...prev, resetPassword: true }))}>
              {t('form.change')}
            </Button>
          )}
        </div>

        {/* Email */}
        <div className="p-4 box-border flex items-center gap-2.5 account-item">
          <img className="size-6" src={getPublicPath('/images/profile/email.png')} alt="" />
          <div className="flex-none text-base text-primary">{t('profile.bind_email')}</div>
          <div className="flex-1 w-0 text-sm text-placeholder invisible md:visible">
            {userStore.info.email || t('profile.unbind_account')}
          </div>
          {(!isOpLocalEnv || (isOpLocalEnv && openSMTP)) && (
            <Button type="link" className="!text-[#586D9A]" onClick={() => setDialogs(prev => ({ ...prev, email: true }))}>
              {userStore.info.email ? t('profile.change') : t('profile.bind')}
            </Button>
          )}
        </div>
      </div>

      {/* Subscription */}
      <h2 className="text-primary font-semibold mt-6">{t('profile.subscription_info')}</h2>
      <Link to="/order" className="flex flex-col mt-4 bg-[#F7F7F7] rounded-lg box-border overflow-hidden">
        <div className="p-4 box-border flex items-center gap-2.5 account-item">
          <img className="size-6" src={getPublicPath('/images/profile/order.png')} alt="" />
          <div className="flex-none text-base text-primary">{t('profile.order_info')}</div>
          <div className="flex-1 w-0 text-sm text-placeholder invisible md:visible" />
          <RightOutlined className="text-regular" />
        </div>
      </Link>

      {/* Profile Dialog */}
      <Modal
        open={dialogs.profile}
        title={t('action.edit') + t('profile.info')}
        onCancel={() => setDialogs(prev => ({ ...prev, profile: false }))}
        onOk={handleSaveProfile}
        okButtonProps={{ disabled: !profileForm.nickname.trim() }}
      >
        <div className="mt-4">
          <div className="w-[73px] text-regular text-opacity-80">{t('form.avatar')}</div>
          <div
            className="mt-3 relative rounded-full w-[60px] h-[60px] overflow-hidden cursor-pointer"
            onClick={handleChangeAvatar}
          >
            <Avatar size={60} src={profileForm.avatar} />
            <div className="absolute bottom-0 left-0 right-0 h-5 flex justify-center items-center bg-black/60 text-white/80 text-xs">
              {t('form.change')}
            </div>
          </div>
        </div>
        <div className="mt-6">
          <div className="w-[73px] text-regular text-opacity-80">{t('form.nickname')}</div>
          <Input
            className="mt-3 flex-1"
            maxLength={15}
            showCount
            value={profileForm.nickname}
            onChange={(e) => setProfileForm(prev => ({ ...prev, nickname: e.target.value }))}
          />
        </div>
        <CropperDialog
          ref={cropperRef}
          onConfirm={handleSuccessCropper}
          cropperDisabled
          limitSize={2}
        />
      </Modal>

      {/* Change Mobile Dialog */}
      <Modal
        open={dialogs.changeMobile}
        title={userStore.info.mobile ? t('profile.change') + t('form.mobile') : t('profile.bind') + t('form.mobile')}
        onCancel={() => { setDialogs(prev => ({ ...prev, changeMobile: false })); resetAllForms() }}
        footer={null}
      >
        {userStore.info.mobile && (
          <div className="mb-4">{t('form.verify_old_mobile')}{userStore.info.mobile}</div>
        )}
        <ChangeMobile
          ref={mobileRef}
          onSuccess={() => handleSuccess('mobile')}
          onClose={() => setDialogs(prev => ({ ...prev, changeMobile: false }))}
        />
      </Modal>

      {/* Reset Password Dialog */}
      <Modal
        open={dialogs.resetPassword}
        title={t('profile.change_password')}
        onCancel={() => { setDialogs(prev => ({ ...prev, resetPassword: false })); resetAllForms() }}
        footer={null}
      >
        <ResetPassword
          ref={passwordRef}
          onSuccess={() => setDialogs(prev => ({ ...prev, resetPassword: false }))}
        />
      </Modal>

      {/* Email Dialog */}
      <Modal
        open={dialogs.email}
        title={userStore.info.email ? t('profile.change') + t('form.email') : t('profile.bind_email')}
        onCancel={() => { setDialogs(prev => ({ ...prev, email: false })); resetAllForms() }}
        footer={null}
      >
        <Email
          ref={emailRef}
          onSuccess={() => handleSuccess('email')}
          onClose={() => setDialogs(prev => ({ ...prev, email: false }))}
        />
      </Modal>

      {/* Unbind WeChat Dialog */}
      <Modal
        open={dialogs.unbindWechat}
        onCancel={() => setDialogs(prev => ({ ...prev, unbindWechat: false }))}
        footer={null}
        closable={false}
        width={480}
      >
        <div className="flex items-center">
          <WarningFilled className="text-[#FF9500] text-2xl" />
          <h2 className="flex-1 w-0 text-primary font-semibold text-lg ml-2">
            {t('profile.unbind_wechat_confirm_title')}
          </h2>
          <CloseOutlined className="text-[#909399] cursor-pointer" onClick={() => setDialogs(prev => ({ ...prev, unbindWechat: false }))} />
        </div>
        <div className="mt-4">{t('profile.unbind_wechat_confirm_desc')}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button className="bg-[#F6F7F9]" onClick={() => setDialogs(prev => ({ ...prev, unbindWechat: false }))}>
            {t('profile.unbind_wechat_confirm_cancel')}
          </Button>
          <Button danger onClick={() => handleUnbindWechat(true)}>
            {t('profile.unbind_wechat_confirm_ok')}
          </Button>
        </div>
      </Modal>

      {/* Bind WeChat Dialog */}
      <Modal
        open={dialogs.bindWechat}
        onCancel={() => setDialogs(prev => ({ ...prev, bindWechat: false }))}
        footer={null}
        closable={false}
        width={500}
      >
        <div className="flex items-center justify-center relative">
          <img className="size-6" src={getPublicPath('/images/profile/wechat.png')} alt="" />
          <h2 className="text-primary font-semibold text-lg ml-2">{t('profile.bind_wechat_title')}</h2>
          <CloseOutlined
            className="text-[#909399] cursor-pointer absolute right-0 -top-2"
            onClick={() => setDialogs(prev => ({ ...prev, bindWechat: false }))}
          />
        </div>
        <div className="h-[280px] overflow-hidden mt-4">
          {qrcodeRender && (
            <WechatView onOauthSuccess={handleOauthSuccess} />
          )}
        </div>
      </Modal>
    </div>
  )
})

UserInfo.displayName = 'UserInfo'

export default UserInfo
