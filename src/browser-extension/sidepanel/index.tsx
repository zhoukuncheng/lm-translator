import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { MessageType } from '../background/index'
import { TranslationResult } from '../../common/translate/types'

// --- 新增类型定义 开始 ---
interface TranslationResultMessage {
    type: typeof MessageType.TRANSLATION_RESULT_UPDATED
    payload: TranslationResult
}

interface PingMessage {
    type: typeof MessageType.PING
}

// 可以根据需要扩展更多消息类型
type BackgroundMessage = TranslationResultMessage | PingMessage

interface SidePanelResponse {
    received?: boolean
    pong?: boolean
    success?: boolean
    error?: string
}
// --- 新增类型定义 结束 ---

function SidePanel() {
    const [translation, setTranslation] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [showNotification, setShowNotification] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const [loading, setLoading] = useState(true) // 添加加载状态
    const [debugInfo, setDebugInfo] = useState<string[]>([]) // 用于调试信息

    // 添加简单的日志函数，既输出到控制台也保存到状态中
    const log = (message: string, obj?: unknown) => {
        const logMessage = obj ? `${message}: ${JSON.stringify(obj)}` : message
        console.log(logMessage)
        setDebugInfo((prev) => [...prev, `${new Date().toISOString().split('T')[1].substring(0, 8)} - ${logMessage}`])
    }

    useEffect(() => {
        const listener = (
            message: BackgroundMessage,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: SidePanelResponse) => void
        ) => {
            log('Sidepanel received message', { type: message.type })

            try {
                if (message.type === MessageType.TRANSLATION_RESULT_UPDATED) {
                    log('Received updated translation', { result: message.payload })
                    if (message.payload.success) {
                        setTranslation(message.payload.text ?? null)
                        setError(null)
                        setLastUpdated(new Date(message.payload.timestamp || Date.now()))
                        // 显示通知
                        setShowNotification(true)
                        setTimeout(() => setShowNotification(false), 3000)
                    } else {
                        setError(message.payload.error ?? 'Translation failed')
                        setTranslation(null)
                    }
                    sendResponse({ received: true })
                } else if (message.type === MessageType.PING) {
                    log('Received PING', { from: sender.tab ? 'content script' : 'extension' })
                    sendResponse({ pong: true })
                }
            } catch (err) {
                log('Error handling message', { error: err })
                // 出错时也尝试发送响应，避免消息挂起
                sendResponse({ error: err instanceof Error ? err.message : String(err) })
            }
        }

        log('Setting up message listener')
        chrome.runtime.onMessage.addListener(listener)

        // 清理函数
        return () => {
            log('Cleaning up message listener')
            chrome.runtime.onMessage.removeListener(listener)
        }
    }, [])

    // 侧边栏打开时立即请求最新的翻译结果
    useEffect(() => {
        log('Sidepanel loaded, requesting last translation...')
        setLoading(true)

        try {
            chrome.runtime.sendMessage({ type: MessageType.GET_LAST_TRANSLATION }, (response) => {
                try {
                    setLoading(false)
                    log('Received response for GET_LAST_TRANSLATION', response)

                    if (chrome.runtime.lastError) {
                        log('Error in GET_LAST_TRANSLATION', { error: chrome.runtime.lastError.message })
                        setError(`Error fetching translation result: ${chrome.runtime.lastError.message}`)
                        return
                    }

                    if (!response) {
                        log('Received empty response')
                        setError('Received empty response')
                        return
                    }

                    if (response && typeof response === 'object') {
                        if (response.success) {
                            log('Setting translation from response', { timestamp: response.timestamp })
                            setTranslation(response.text ?? null)
                            setLastUpdated(response.timestamp ? new Date(response.timestamp) : new Date())
                            setError(null)
                        } else if (!response.success && response.error) {
                            log('Setting error from response', { error: response.error })
                            setError(response.error)
                            setTranslation(null)
                        } else {
                            log('Unexpected response structure', response)
                            setError('Received invalid response structure')
                        }
                    } else {
                        log('Non-object response', { response })
                        setError('Received non-object response')
                    }
                } catch (err) {
                    log('Error processing response', { error: err })
                    setError(`Error processing response: ${err instanceof Error ? err.message : String(err)}`)
                    setLoading(false)
                }
            })
        } catch (err) {
            log('Error sending GET_LAST_TRANSLATION message', { error: err })
            setError(`Error sending message: ${err instanceof Error ? err.message : String(err)}`)
            setLoading(false)
        }
    }, [])

    // 格式化上次更新时间
    const formatLastUpdated = () => {
        if (!lastUpdated) return ''
        return lastUpdated.toLocaleTimeString()
    }

    return (
        <div>
            <h1>Result</h1>

            {lastUpdated && (
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                    Last updated: {formatLastUpdated()}
                </div>
            )}

            {loading ? (
                <div className='waiting'>Waiting Result...</div>
            ) : (
                <>
                    {error && <p className='error'>Error: {error}</p>}

                    {translation ? (
                        <pre>{translation}</pre>
                    ) : (
                        !error && (
                            <p className='waiting'>
                                Waiting for translation... Please select text on the page and use the translator.
                            </p>
                        )
                    )}
                </>
            )}

            {!translation && !error && !loading && (
                <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
                    <p>💡 Tips:</p>
                    <ul>
                        <li>
                            Right-click on the text you want to translate and select `&quot;`OpenAI Translator`&rdquo;`
                        </li>
                        <li>Or use the shortcut key to select and translate text</li>
                        <li>After translation, you can view the result in this sidebar</li>
                    </ul>
                </div>
            )}

            <div className={`notification ${showNotification ? 'show' : ''}`}>Result Updated!</div>

            {/* 开发环境中的调试面板 - 在生产环境中可以删除或条件显示 */}
            {debugInfo.length > 0 && (
                <div style={{ marginTop: '40px', borderTop: '1px dashed #ccc', paddingTop: '10px' }}>
                    <details>
                        <summary style={{ cursor: 'pointer', color: '#666', fontSize: '12px' }}>Debug Info</summary>
                        <pre
                            style={{
                                fontSize: '11px',
                                background: '#f5f5f5',
                                padding: '8px',
                                maxHeight: '200px',
                                overflow: 'auto',
                            }}
                        >
                            {debugInfo.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                        </pre>
                    </details>
                </div>
            )}
        </div>
    )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
    <React.StrictMode>
        <SidePanel />
    </React.StrictMode>
)
