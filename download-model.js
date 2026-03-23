const { pipeline } = require("@xenova/transformers");

pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2")
  .then(() => {
    console.log("下载成功！");
    process.exit(0);
  })
  .catch((e) => {
    console.error("失败:", e.message);
    process.exit(1);
  });
