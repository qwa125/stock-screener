export default typeof definePageConfig === 'function'
  ? definePageConfig({ navigationBarTitleText: '管理面板' })
  : { navigationBarTitleText: '管理面板' }