/** 构建时 .css 按文本打包（scripts/build.mjs 的 loader），拼进页面的 <style> */
declare module '*.css' {
  const text: string;
  export default text;
}
