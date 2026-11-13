/**
 * SpeakerEmbeddingExtractor JS 封装（KM 定制 wasm 专属，官方变体未编译此 API）。
 *
 * 结构体布局（c-api.h，勿改字段顺序——C 内存布局）：
 *   SherpaOnnxSpeakerEmbeddingExtractorConfig { model*, num_threads, debug, provider* }
 *
 * 用法（句级声纹：VAD 切句后整段提嵌入）：
 *   const ext = createSpeakerEmbeddingExtractor(Module, { model: '/wespeaker.onnx' })
 *   const s = ext.createStream()
 *   s.acceptWaveform(16000, sentencePcm)
 *   if (ext.isReady(s)) { const emb = ext.computeEmbedding(s); ext.destroyEmbedding(emb) }
 *   s.free()
 */

/* eslint-disable */

function initSherpaOnnxSpeakerEmbeddingExtractorConfig(config, Module) {
  const modelLen = Module.lengthBytesUTF8(config.model || '') + 1;
  const providerLen = Module.lengthBytesUTF8(config.provider || 'cpu') + 1;

  const modelBuffer = Module._malloc(modelLen);
  const providerBuffer = Module._malloc(providerLen);

  Module.stringToUTF8(config.model || '', modelBuffer, modelLen);
  Module.stringToUTF8(config.provider || 'cpu', providerBuffer, providerLen);

  // 2 个 char* + 2 个 int32
  const len = 4 * 4;
  const ptr = Module._malloc(len);

  let offset = 0;
  Module.setValue(ptr + offset, modelBuffer, 'i8*');
  offset += 4;
  Module.setValue(ptr + offset, (config.numThreads || 1) | 0, 'i32');
  offset += 4;
  Module.setValue(ptr + offset, (config.debug || 0) | 0, 'i32');
  offset += 4;
  Module.setValue(ptr + offset, providerBuffer, 'i8*');

  return {
    buffer: modelBuffer,  // free 时统一释放（provider 紧随其后，见 freeConfig）
    providerBuffer: providerBuffer,
    ptr: ptr,
    len: len,
  };
}

function freeSpeakerEmbeddingExtractorConfig(config, Module) {
  Module._free(config.buffer);
  Module._free(config.providerBuffer);
  Module._free(config.ptr);
}

class SpeakerEmbeddingExtractor {
  constructor(configObj, Module) {
    const config = initSherpaOnnxSpeakerEmbeddingExtractorConfig(configObj, Module);
    const handle = Module._SherpaOnnxCreateSpeakerEmbeddingExtractor(config.ptr);
    freeSpeakerEmbeddingExtractorConfig(config, Module);

    this.handle = handle;
    this.Module = Module;
    this.dim = Module._SherpaOnnxSpeakerEmbeddingExtractorDim(handle);
  }

  free() {
    if (this.handle) {
      this.Module._SherpaOnnxDestroySpeakerEmbeddingExtractor(this.handle);
      this.handle = 0;
    }
  }

  /** 声纹维度（wespeaker = 256） */
  getDim() {
    return this.dim;
  }

  /** 创建喂入流（复用 OnlineStream：acceptWaveform(sampleRate, samples)） */
  createStream() {
    const handle = this.Module._SherpaOnnxSpeakerEmbeddingExtractorCreateStream(this.handle);
    return new OnlineStream(handle, this.Module);
  }

  /** 流内特征帧是否足够计算嵌入（句级场景喂完整句后即 ready） */
  isReady(stream) {
    return this.Module._SherpaOnnxSpeakerEmbeddingExtractorIsReady(this.handle, stream.handle) == 1;
  }

  /** 计算嵌入（Float32Array，dim 维；用完必须 destroyEmbedding） */
  computeEmbedding(stream) {
    const p = this.Module._SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(this.handle, stream.handle);
    const out = new Float32Array(this.dim);
    // HEAPF32 视图拷贝（p 是 float*）
    for (let i = 0; i < this.dim; i++) {
      out[i] = this.Module.HEAPF32[p / 4 + i];
    }
    this.Module._SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(p);
    return out;
  }
}

function createSpeakerEmbeddingExtractor(Module, config) {
  return new SpeakerEmbeddingExtractor(config, Module);
}
