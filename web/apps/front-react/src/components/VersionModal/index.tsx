import { Modal, Divider } from 'antd'
import './version-modal.css'

export function VersionModal() {
  return (
    <Modal open width={1084} footer={null} closable>
      <div className="version-modal-content">
        <div className="version-modal-main">
          <div className="version-steps">
            <div>1</div>
            <div>2</div>
            <div>3</div>
          </div>
          <div>
            <p className="version-title">选择购买时长</p>
            <div className="version-options">
              <div className="version-option">
                <div className="version-option-label">1个月</div>
                <div className="version-option-price">
                  <span className="price-currency">¥</span>
                  <span className="price-amount">88</span>
                  /月
                </div>
              </div>
              <div className="version-option">
                <div className="version-option-label">1年</div>
                <div className="version-option-price">
                  <span className="price-currency">¥</span>
                  <span className="price-amount">88</span>
                  /月
                </div>
                <div className="version-option-original">原价：¥1056/年</div>
              </div>
            </div>
          </div>
        </div>
        <div className="version-modal-aside">右边</div>
      </div>
    </Modal>
  )
}

export default VersionModal
