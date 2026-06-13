import Taro from '@tarojs/taro'

/**
 * 网络请求模块
 * 封装 Taro.request、Taro.uploadFile、Taro.downloadFile
 * 对于相对路径（以 / 开头），直接使用原路径（浏览器自动从当前域名解析）
 * 对于绝对路径（http/https），保持原样
 *
 * IMPORTANT: 项目可能全局注入 PROJECT_DOMAIN，但在非 Coze 环境部署时
 * 使用相对路径可以自动适配任何域名，无需修改部署配置
 */
export namespace Network {
    const createUrl = (url: string): string => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url
        }
        return url
    }

    export const request: typeof Taro.request = option => {
        return Taro.request({
            ...option,
            url: createUrl(option.url),
        })
    }

    export const uploadFile: typeof Taro.uploadFile = option => {
        return Taro.uploadFile({
            ...option,
            url: createUrl(option.url),
        })
    }

    export const downloadFile: typeof Taro.downloadFile = option => {
        return Taro.downloadFile({
            ...option,
            url: createUrl(option.url),
        })
    }
}
