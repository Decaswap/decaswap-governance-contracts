pragma solidity 0.6.12;

interface IToken {
    function getPriorVotes(address account, uint blockNumber) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}