import { BigNumber, providers, Wallet, ethers } from "ethers";
import { gasPriceToGwei } from "./utils";
import { config } from "dotenv";
config();

require("log-timestamp");

const BRIBE = 30;

const GWEI = BigNumber.from(10).pow(9);
let PRIORITY_GAS_PRICE = GWEI.mul(BRIBE);

const PRIVATE_KEY_SOURCE = process.env.PRIVATE_KEY_SOURCE || "";
const PUBLIC_KEY_DESTINATION = process.env.PUBLIC_KEY_DESTINATION || "";

if (PRIVATE_KEY_SOURCE === "") {
  console.warn(
    "Must provide PRIVATE_KEY_SOURCE environment variable, corresponding to Ethereum EOA with assets to be transferred"
  );
  process.exit(1);
}
if (PUBLIC_KEY_DESTINATION === "") {
  console.warn(
    "Must provide PUBLIC_KEY_DESTINATION environment variable, an address which will receive assets"
  );
  process.exit(1);
}

async function ethsweeper() {
  const INFURA_RPC_URL = process.env.INFURA_RPC_URL;
  const providerInfura = new providers.StaticJsonRpcProvider(INFURA_RPC_URL);

  const signer = new ethers.Wallet(PRIVATE_KEY_SOURCE, providerInfura);

  providerInfura.on("block", async (blockNumber) => {
    const block = await providerInfura.getBlock("latest");
    const chain = await (await providerInfura.getNetwork()).chainId;

    const maxBaseFeeInFutureBlock = block.baseFeePerGas as BigNumber;

    const priorityFee = PRIORITY_GAS_PRICE;

    const currentBalance = await providerInfura.getBalance(signer.address);

    const gasUsed = 21000;

    const gasEstimateTotal = priorityFee
      .add(maxBaseFeeInFutureBlock)
      .mul(gasUsed);

    const sendValue = currentBalance.sub(gasEstimateTotal);

    console.log(`=====${blockNumber} on chainid ${chain}=====`);
    console.log(
      `current balance: ${ethers.utils.formatEther(currentBalance)} ETH`
    );
    console.log(
      `base gas: ${gasPriceToGwei(block.baseFeePerGas as BigNumber)} gwei`
    );
    console.log(
      `base gas + bribe: ${gasPriceToGwei(
        priorityFee.add(maxBaseFeeInFutureBlock)
      )} gwei`
    );
    console.log(`gas used: ${gasUsed}`);
    console.log(`current gas cost: ${gasPriceToGwei(gasEstimateTotal)} gwei`);
    console.log(
      `expected sent value: ${ethers.utils.formatEther(sendValue)} ETH`
    );

    if (sendValue > BigNumber.from(0)) {
      const tx = {
        from: await signer.getAddress(),
        to: PUBLIC_KEY_DESTINATION,
        value: sendValue,
        nonce: await providerInfura.getTransactionCount(
          await signer.getAddress(),
          "latest"
        ),
        gasLimit: gasUsed,
        gasPrice: priorityFee.add(maxBaseFeeInFutureBlock),
      };

      console.log(tx);

      signer
        .sendTransaction(tx)
        .then((transaction) => {
          console.dir(transaction);
          console.log("Send finished!");
        })
        .catch((err) => {
          console.log("Send failed!");
          console.log(err);
        });
    }
  });
}

ethsweeper();
