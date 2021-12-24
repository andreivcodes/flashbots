import { BigNumber } from "ethers";
import { parseTransaction, keccak256 } from "ethers/lib/utils";

export const ETHER = BigNumber.from(10).pow(18);
export const GWEI = BigNumber.from(10).pow(9);

export function gasPriceToGwei(gasPrice: BigNumber): number {
  return gasPrice.mul(100).div(GWEI).toNumber() / 100;
}
