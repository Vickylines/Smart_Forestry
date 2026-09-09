export const repositoryUrl = 'https://github.com/Vickylines/Smart_Forestry';

export function openRepository() {
  // #ifdef H5
  const native = (window as any).ForestAndroidPreview;
  if (native) {
    if (native.openRepository) native.openRepository();
    else uni.showToast({title:'请更新 Android 安装包后打开仓库',icon:'none'});
    return;
  }
  window.open(repositoryUrl, '_blank', 'noopener,noreferrer');
  return;
  // #endif
  // #ifndef H5
  uni.setClipboardData({data:repositoryUrl,success:() => uni.showToast({title:'仓库地址已复制，请在浏览器打开',icon:'none'})});
  // #endif
}
