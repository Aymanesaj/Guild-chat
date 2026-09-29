const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main() {
while (1) {
  console.log('identity service...');
  await sleep(2000);
}
}

main();