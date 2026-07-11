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
                            "model_id": "deepseek-ai/DeepSeek-V4-Flash",
                            "model_name": "DeepSeek-V4-Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-ai/DeepSeek-V4-Pro",
                            "model_name": "DeepSeek-V4-Pro",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-ai/DeepSeek-V3.2",
                            "model_name": "DeepSeek-V3.2",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "zai-org/GLM-5.2",
                            "model_name": "GLM-5.2",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshotai/Kimi-K2.7-Code",
                            "model_name": "Kimi-K2.7-Code",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "Qwen/Qwen3.6-35B-A3B",
                            "model_name": "Qwen3.6-35B-A3B",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "Qwen/Qwen3-VL-32B-Instruct",
                            "model_name": "Qwen3-VL-32B-Instruct",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
                            "model_name": "Qwen3-Coder-30B-A3B-Instruct",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "MiniMaxAI/MiniMax-M2.5",
                            "model_name": "MiniMax-M2.5",
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
                        },
                        {
                            "model_id": "Pro/BAAI/bge-m3",
                            "model_name": "Pro/BAAI/bge-m3",
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
                            "model_id": "Pro/BAAI/bge-reranker-v2-m3",
                            "model_name": "Pro/bge-reranker-v2-m3"
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
                            "model_id": "deepseek-v4-flash",
                            "model_name": "DeepSeek-V4-Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v4-pro",
                            "model_name": "DeepSeek-V4-Pro",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v3.2",
                            "model_name": "DeepSeek-V3.2",
                            "deep_thinking": false
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
                            "model_id": "gpt-4o-mini",
                            "model_name": "GPT-4o-mini",
                            "deep_thinking": false,
                            "vision": true
                        },
                        {
                            "model_id": "gpt-4",
                            "model_name": "gpt-4",
                            "deep_thinking": false
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
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
                        },
                        {
                            "model_id": "text-embedding-ada-002",
                            "model_name": "text-embedding-ada-002",
                            "dimensions": 1536,
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
                            "model_id": "gpt-5",
                            "model_name": "GPT-5",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gpt-5-mini",
                            "model_name": "GPT-5-mini",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gpt-5-nano",
                            "model_name": "GPT-5-nano",
                            "deep_thinking": false
                        },
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
                            "model_id": "o3",
                            "model_name": "O3",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "o4-mini",
                            "model_name": "O4-mini",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "o1",
                            "model_name": "O1",
                            "deep_thinking": true
                        }
                    ]
                },
                {
                    "model_type": 2,
                    "models": [
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
            "platform_name": "阿里百炼",
            "platform_id": "alibaba_bailian",
            "channel_type": 17,
            "can_multiple": false,
            "categories": [
                {
                    "model_type": 1,
                    "models": [
                        {
                            "model_id": "qwen3.7-max",
                            "model_name": "Qwen3.7-Max",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen3.7-plus",
                            "model_name": "Qwen3.7-Plus",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen3.6-flash",
                            "model_name": "Qwen3.6-Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "qwen3-coder-plus",
                            "model_name": "Qwen3-Coder-Plus",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v4-pro",
                            "model_name": "DeepSeek-V4-Pro",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v4-flash",
                            "model_name": "DeepSeek-V4-Flash",
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
                            "model_id": "doubao-seed-2-0-lite-260428",
                            "model_name": "Doubao-Seed-2.0-Lite",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "doubao-seed-2-0-mini-260428",
                            "model_name": "Doubao-Seed-2.0-Mini",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "doubao-seed-2-0-pro-260215",
                            "model_name": "Doubao-Seed-2.0-Pro",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "doubao-seed-2-0-code-preview-260215",
                            "model_name": "Doubao-Seed-2.0-Code",
                            "deep_thinking": true
                        },
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
                            "model_id": "deepseek-v4-pro-260425",
                            "model_name": "DeepSeek-V4-Pro",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v4-flash-260425",
                            "model_name": "DeepSeek-V4-Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "deepseek-v3-2-251201",
                            "model_name": "DeepSeek-V3.2",
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
                            "model_id": "kimi-k2.7-code",
                            "model_name": "Kimi K2.7 Code",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "kimi-k2.6",
                            "model_name": "Kimi K2.6",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "kimi-k2.5",
                            "model_name": "Kimi K2.5",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-128k",
                            "model_name": "Moonshot V1 128K",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-32k",
                            "model_name": "Moonshot V1 32K",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-8k",
                            "model_name": "Moonshot V1 8K",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "moonshot-v1-8k-vision-preview",
                            "model_name": "Moonshot V1 8K Vision Preview",
                            "deep_thinking": false,
                            "vision": true
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
                            "model_id": "gemini-3.5-flash",
                            "model_name": "Gemini 3.5 Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-3.1-flash-lite",
                            "model_name": "Gemini 3.1 Flash Lite",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-3.1-pro-preview",
                            "model_name": "Gemini 3.1 Pro Preview",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "gemini-2.5-pro",
                            "model_name": "Gemini 2.5 Pro",
                            "deep_thinking": true
                        },
                        {
                            "model_id": "gemini-2.5-flash",
                            "model_name": "Gemini 2.5 Flash",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-2.5-flash-lite",
                            "model_name": "Gemini 2.5 Flash Lite",
                            "deep_thinking": false
                        },
                        {
                            "model_id": "gemini-3-flash-preview",
                            "model_name": "Gemini 3 Flash Preview",
                            "deep_thinking": false
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
                            "max_tokens": 8192
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
                            "dimensions": 4096,
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
