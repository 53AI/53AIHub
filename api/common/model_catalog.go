package common

// KmModelsJSON 模型目录配置JSON常量
const KmModelsJSON = `{
    "platforms": [
        {
            "platform_name": "硅基流动",
            "platform_id": "siliconflow",
            "channel_type": 44,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "deepseek-ai/DeepSeek-V3.2-Exp",
                            "model_name": "Deepseek-v3.2-Exp",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-ai/DeepSeek-V3.1-Terminus",
                            "model_name": "DeepSeek-V3.1-Terminus",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-ai/DeepSeek-R1",
                            "model_name": "Deepseek-R1",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "baidu/ERNIE-4.5-300B-A47B",
                            "model_name": "ERNIE-4.5-300B-M4TB",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshotai/Kimi-K2-Instruct",
                            "model_name": "Kimi-K2-Instruct",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "Qwen/Qwen3-8B",
                            "model_name": "Qwen/Qwen3-8B",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "Qwen/Qwen2.5-7B-Instruct",
                            "model_name": "Qwen/Qwen2.5-7B-Instruct",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "THUDM/glm-4-9b-chat",
                            "model_name": "THUDM/glm-4-9b-chat",
                            "deep_thinking": false
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
                        {
                            "model_id": "Qwen/Qwen3-Embedding-8B",
                            "model_name": "Qwen/Qwen3-Embedding-8B",
                            "dimensions": 2560,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "Qwen/Qwen3-Embedding-4B",
                            "model_name": "Qwen/Qwen3-Embedding-4B",
                            "dimensions": 2560,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "Qwen/Qwen3-Embedding-0.6B",
                            "model_name": "Qwen/Qwen3-Embedding-0.6B",
                            "dimensions": 1024,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "BAAI/bge-m3",
                            "model_name": "BAAI/bge-m3",
                            "dimensions": 1024,
                            "max_tokens": 8192
                        }
                    ]
                },
                {
                    "model_type": 3,
                    "models": [
                        {
                            "model_id": "Qwen/Qwen3-Reranker-8B",
                            "model_name": "Qwen3-Reranker-8B"
                        },
                        {
                            "model_id": "Qwen/Qwen3-Reranker-4B",
                            "model_name": "Qwen3-Reranker-4B"
                        },
                        {
                            "model_id": "Qwen/Qwen3-Reranker-0.6B",
                            "model_name": "Qwen3-Reranker-0.6B"
                        },
                        {
                            "model_id": "BAAI/bge-reranker-v2-m3",
                            "model_name": "bge-reranker-v2-m3"
                        },
                        {
                            "model_id": "netease-youdao/bce-reranker-base_v1",
                            "model_name": "bce-reranker-base_v1"
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "DeepSeek",
            "platform_id": "deepseek",
            "channel_type": 36,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "deepseek-chat",
                            "model_name": "Deepseek-v3",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-coder",
                            "model_name": "Deepseek-coder",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-reasoner",
                            "model_name": "Deepseek-R1",
                            "deep_thinking": true
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "Azure OpenAI",
            "platform_id": "azure_openai",
            "channel_type": 3,
            "can_multiple": true,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "gpt-4o",
                            "model_name": "gpt-4o",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "gpt-4",
                            "model_name": "gpt-4",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gpt-4o-mini",
                            "model_name": "GPT-4o-mini",
                            "deep_thinking": false,
                            "vision": true
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
                        {
                            "model_id": "text-embedding-ada-002",
                            "model_name": "text-embedding-ada-002",
                            "dimensions": 1536,
                            "max_tokens": 8191
                        },
                        {
                            "model_id": "text-embedding-3-small",
                            "model_name": "text-embedding-3-small",
                            "dimensions": 1536,
                            "max_tokens": 8191
                        },
                        {
                            "model_id": "text-embedding-3-large",
                            "model_name": "text-embedding-3-large",
                            "dimensions": 3072,
                            "max_tokens": 8191
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "OpenAI",
            "platform_id": "openai",
            "channel_type": 1,
            "can_multiple": true,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "gpt-4o",
                            "model_name": "GPT-4o",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "gpt-4o-mini",
                            "model_name": "GPT-4o-mini",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "gpt-4.1",
                            "model_name": "GPT-4.1",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gpt-4.1-mini",
                            "model_name": "GPT-4.1-mini",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "o1",
                            "model_name": "O1",
                            "deep_thinking": false
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "阿里百炼",
            "platform_id": "alibaba_bailian",
            "channel_type": 17,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "qwen-plus",
                            "model_name": "Qwen-plus",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen-max",
                            "model_name": "Qwen-Max",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen-flash",
                            "model_name": "Qwen-Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen3-coder-plus",
                            "model_name": "Qwen3-Coder-Plus",
                            "deep_thinking": false
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
                        {
                            "model_id": "text-embedding-v4",
                            "model_name": "Qwen-text-embedding-v4",
                            "dimensions": 1024,
                            "max_tokens": 2048
                        },
                        {
                            "model_id": "text-embedding-v3",
                            "model_name": "Qwen-text-embedding-v3",
                            "dimensions": 1024,
                            "max_tokens": 2048
                        }
                    ]
                },
                {
                    "model_type": 3,
                    "models": [
                        {
                            "model_id": "qwen-gte-rerank-v2",
                            "model_name": "Qwen-gte-rerank-v2"
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "火山方舟",
            "platform_id": "volcengine",
            "channel_type": 900,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "doubao-seed-1-6-251015",
                            "model_name": "Doubao-Seed-1.6",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "doubao-seed-1-6-flash-250828",
                            "model_name": "Doubao-Seed-1.6-flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-r1-250528",
                            "model_name": "DeepSeek-R1",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v3-250324",
                            "model_name": "DeepSeek-V3",
                            "deep_thinking": false
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
                        {
                            "model_id": "doubao-embedding-large-text-250515",
                            "model_name": "Doubao-embedding-large",
                            "dimensions": 2048,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "doubao-embedding-text-240715",
                            "model_name": "Doubao-embedding-text",
                            "dimensions": 2560,
                            "max_tokens": 8192
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "月之暗面",
            "platform_id": "moonshot",
            "channel_type": 25,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "kimi-k2-turbo-preview",
                            "model_name": "Kimi Turbo Preview",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "kimi-k2-thinking-turbo",
                            "model_name": "Kimi Thinking Turbo",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "moonshot-v1-32k",
                            "model_name": "Moonshot V1 32K",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-128k",
                            "model_name": "Moonshot V1 128K",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-32k-vision-preview",
                            "model_name": "Moonshot V1 32K Vision Preview",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "moonshot-v1-128k-vision-preview",
                            "model_name": "Moonshot V1 128K Vision Preview",
                            "deep_thinking": false,
                            "vision": true
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "Gemini",
            "platform_id": "gemini",
            "channel_type": 24,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "gemini-2.5-flash-lite",
                            "model_name": "Gemini 2.5 Flash Lite",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-2.5-flash",
                            "model_name": "Gemini 2.5 Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-2.5-pro",
                            "model_name": "Gemini 2.5 Pro",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "gemini-3-flash-preview",
                            "model_name": "Gemini 3 Flash Preview",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-3.1-pro-preview",
                            "model_name": "Gemini 3.1 Pro Preview",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "gemini-3-pro-image-preview",
                            "model_name": "Gemini 3 Pro Image Preview",
                            "deep_thinking": false,
                            "vision": true
                        }
                    ]
                }
            ]
        },
        {
            "platform_name": "自定义模型（兼容OpenAI）",
            "platform_id": "custom_openai",
            "channel_type": 1012,
            "can_multiple": true,
            "categories": [
                {
                    "model_type": 1,
                    "models": []
                },
                {
                    "model_type": 2,
                    "models": []
                },
                {
                    "model_type": 3,
                    "models": []
                }
            ]
        },
        {
            "platform_name": "百度千帆ModelBuilder",
            "platform_id": "baidu_qianfan",
            "channel_type": 901,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 2,
                    "models": [
                        {
                            "model_id": "embedding-v1",
                            "model_name": "Embedding-V1",
                            "dimensions": 384,
                            "max_tokens": 384
                        },
                        {
                            "model_id": "tao-8k",
                            "model_name": "tao-8k",
                            "dimensions": 1024,
                            "max_tokens": 8192,
                            "deep_thinking": false
                        },
                        {
                            "model_id": "bge-large-zh",
                            "model_name": "bge-large-zh",
                            "dimensions": 1024,
                            "max_tokens": 512
                        },
                        {
                            "model_id": "bge-large-en",
                            "model_name": "bge-large-en",
                            "dimensions": 1024,
                            "max_tokens": 512
                        },
                        {
                            "model_id": "qwen3-embedding-0.6b",
                            "model_name": "Qwen3-Embedding-0.6B",
                            "dimensions": 1024,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "qwen3-embedding-4b",
                            "model_name": "Qwen3-Embedding-4B",
                            "dimensions": 2560,
                            "max_tokens": 8192
                        },
                        {
                            "model_id": "qwen3-embedding-8b",
                            "model_name": "Qwen3-Embedding-8B",
                            "dimensions": 2560,
                            "max_tokens": 8192
                        }
                    ]
                },
                {
                    "model_type": 3,
                    "models": [
                        {
                            "model_id": "bce-reranker-base",
                            "model_name": "bce-reranker-base"
                        },
                        {
                            "model_id": "qwen3-reranker-0.6b",
                            "model_name": "Qwen3-Reranker-0.6B"
                        },
                        {
                            "model_id": "qwen3-reranker-8b",
                            "model_name": "Qwen3-Reranker-8B"
                        }
                    ]
                }
            ]
        }
    ]
}`
