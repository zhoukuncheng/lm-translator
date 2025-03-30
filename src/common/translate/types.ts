/**
 * 翻译结果类型接口
 */
export interface TranslationResult {
    /**
     * 翻译是否成功
     */
    success: boolean

    /**
     * 翻译后的文本
     */
    text?: string

    /**
     * 错误信息，如果翻译失败
     */
    error?: string

    /**
     * 时间戳，记录翻译结果生成时间
     */
    timestamp?: number
}
