/* eslint-disable camelcase */
import { urlJoin } from 'url-join-ts'
import { getUniversalFetch } from '../universal-fetch'
import { fetchSSE, getSettings } from '../utils'
import { AbstractEngine } from './abstract-engine'
import { IMessageRequest, IModel } from './interfaces'
import qs from 'qs'

const SAFETY_SETTINGS = [
    {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
    },
    {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
    },
    {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
    },
    {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
    },
    {
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
        threshold: 'BLOCK_NONE',
    },
]

export class Gemini extends AbstractEngine {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listModels(apiKey: string | undefined): Promise<IModel[]> {
        if (!apiKey) {
            return []
        }
        const settings = await getSettings()
        const geminiAPIURL = settings.geminiAPIURL
        const url =
            urlJoin(geminiAPIURL, '/v1beta/models') +
            qs.stringify({ key: apiKey, pageSize: 1000 }, { addQueryPrefix: true })
        const fetcher = getUniversalFetch()
        const resp = await fetcher(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        const jsn = await resp.json()
        if (!jsn.models) {
            return []
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return jsn.models.map((model: any) => {
            const name = model.name.split('/').pop()
            return {
                id: name,
                name: name,
            }
        })
    }

    async getModel() {
        const settings = await getSettings()
        return settings.geminiAPIModel
    }

    async sendMessage(req: IMessageRequest): Promise<void> {
        const settings = await getSettings()
        const apiKey = settings.geminiAPIKey
        const geminiAPIURL = settings.geminiAPIURL
        const model = await this.getModel()
        const url =
            urlJoin(geminiAPIURL, '/v1beta/models/', `${model}:streamGenerateContent`) +
            qs.stringify({ key: apiKey }, { addQueryPrefix: true })
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36 Edg/91.0.864.41',
        }
        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: req.rolePrompt ? req.rolePrompt + '\n\n' + req.commandPrompt : req.commandPrompt,
                        },
                    ],
                },
            ],
            safetySettings: SAFETY_SETTINGS,
        }

        let hasError = false
        let finished = false
        await fetchSSE(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: req.signal,
            usePartialArrayJSONParser: true,
            onMessage: async (msg) => {
                if (finished) return
                let resp
                try {
                    resp = JSON.parse(msg)
                } catch (e) {
                    hasError = true
                    finished = true
                    req.onError(JSON.stringify(e))
                    return
                }

                // Check for prompt feedback first (e.g., blocked prompt)
                if (resp.promptFeedback) {
                    hasError = true
                    finished = true
                    const reason = resp.promptFeedback.blockReason || 'Unknown reason'
                    req.onError(`Prompt blocked or invalid: ${reason}`)
                    return
                }

                // Now check for candidates
                if (!resp.candidates || resp.candidates.length === 0) {
                    // It's possible this is just the final message chunk without candidates but with usageMetadata
                    // We shouldn't necessarily treat it as an error unless it's the *only* thing received.
                    // However, the existing logic treats it as an error, so we'll keep that for now,
                    // but it might need refinement if valid responses sometimes lack candidates.
                    // For now, we assume a message *should* have candidates if it's not promptFeedback.
                    hasError = true
                    finished = true
                    req.onError('Received response object without candidates')
                    return
                }

                // Check finish reason within the candidate
                if (resp.candidates[0].finishReason && resp.candidates[0].finishReason !== 'STOP') {
                    finished = true
                    // Pass the specific finish reason if available
                    req.onFinished(resp.candidates[0].finishReason)
                    return
                }

                // Ensure content and parts exist before accessing text
                if (
                    resp.candidates[0].content &&
                    resp.candidates[0].content.parts &&
                    resp.candidates[0].content.parts.length > 0
                ) {
                    const targetTxt = resp.candidates[0].content.parts[0].text
                    if (targetTxt !== undefined && targetTxt !== null) {
                        await req.onMessage({ content: targetTxt, role: '' })
                    }
                } else {
                    // Handle cases where content or parts might be missing, though ideally the API shouldn't send this
                    console.warn('Received candidate without expected content structure:', resp.candidates[0])
                }
            },
            onError: (err) => {
                hasError = true
                if (err instanceof Error) {
                    req.onError(err.message)
                    return
                }
                if (typeof err === 'string') {
                    req.onError(err)
                    return
                }
                if (typeof err === 'object') {
                    const item = err[0]
                    if (item && item.error && item.error.message) {
                        req.onError(item.error.message)
                        return
                    }
                }
                const { error } = err
                if (error instanceof Error) {
                    req.onError(error.message)
                    return
                }
                if (typeof error === 'object') {
                    const { message } = error
                    if (message) {
                        if (typeof message === 'string') {
                            req.onError(message)
                        } else {
                            req.onError(JSON.stringify(message))
                        }
                        return
                    }
                }
                req.onError('Unknown error')
            },
        })

        if (!finished && !hasError) {
            req.onFinished('stop')
        }
    }
}
