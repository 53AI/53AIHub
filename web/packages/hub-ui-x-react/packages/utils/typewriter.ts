// 打字机队列 - 批量输出版本（优化性能）
export class Typewriter {
  private queue: string[] = [];
  private consuming = false;
  private rafId: number | null = null;
  private doneTimer: ReturnType<typeof setTimeout> | null = null;
  private batchBuffer: string = "";
  private lastFlushTime: number = 0;
  private flushInterval: number = 50; // ms，批量刷新间隔

  constructor(
    private onConsume: (str: string) => void,
    public callBack?: () => void,
  ) {}

  // 动态计算批量大小 - 队列长时批量输出，短时保持打字感
  private getBatchSize(): number {
    const len = this.queue.length;
    if (len > 1000) return 100;
    if (len > 500) return 50;
    if (len > 200) return 30;
    if (len > 100) return 20;
    if (len > 50) return 10;
    if (len > 20) return 5;
    return 2;
  }

  // 添加字符串到队列
  add(str: string) {
    if (!str) return;
    str = str.replace(/\\n/g, "\n");
    this.queue.push(...str.split(""));
  }

  // 消费一批字符，累积到 buffer
  private consume() {
    if (this.queue.length === 0) {
      return;
    }

    const batchSize = this.getBatchSize();
    const batch: string[] = [];

    for (let i = 0; i < batchSize && this.queue.length > 0; i++) {
      const char = this.queue.shift();
      if (char) batch.push(char);
    }

    if (batch.length > 0) {
      this.batchBuffer += batch.join("");
    }
  }

  // 刷新 buffer 到 UI（减少 React 更新频率）
  private flush() {
    if (this.batchBuffer.length > 0) {
      this.onConsume(this.batchBuffer);
      this.batchBuffer = "";
      this.lastFlushTime = performance.now();
    }
  }

  // 使用 requestAnimationFrame 驱动
  private tick = () => {
    if (!this.consuming || this.queue.length === 0) {
      // 最后刷新一次确保不丢内容
      this.flush();
      this.consuming = false;
      return;
    }

    this.consume();

    const now = performance.now();
    // 达到刷新间隔或队列即将清空时刷新
    if (now - this.lastFlushTime >= this.flushInterval || this.queue.length < 10) {
      this.flush();
    }

    // 如果还有字符，继续下一帧
    if (this.queue.length > 0) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      // 确保最后的内容被刷新
      this.flush();
      this.consuming = false;
    }
  };

  // 开始消费队列
  start() {
    if (this.consuming) return;
    if (this.queue.length === 0) return;

    this.consuming = true;
    this.lastFlushTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  // 暂停消费
  pause() {
    this.consuming = false;
    // 刷新剩余内容
    this.flush();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // 停止并清空队列
  stop() {
    this.pause();
    this.queue = [];
    this.batchBuffer = "";
    if (this.doneTimer) {
      clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
  }

  // 自动等打印完再结束消费队列，且有传回调函数的话执行回调函数
  done() {
    if (this.queue.length === 0) {
      this.pause();
      this.callBack?.();
    } else {
      this.doneTimer = setTimeout(() => {
        this.done();
      }, 100);
    }
  }

  // 获取队列长度
  getQueueLength(): number {
    return this.queue.length;
  }

  // 是否正在消费
  isConsuming(): boolean {
    return this.consuming;
  }
}
