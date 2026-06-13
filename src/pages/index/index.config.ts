export default typeof definePageConfig === 'function'
  ? definePageConfig({ navigationBarTitleText: '股票分析助手' })
  : { navigationBarTitleText: '股票分析助手' }
