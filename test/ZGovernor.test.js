const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');
const ethers = require('ethers');
const SushiToken = artifacts.require('SushiToken');
const MasterChef = artifacts.require('MasterChef');
const Timelock = artifacts.require('Timelock');
const GovernorAlpha = artifacts.require('GovernorAlpha');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');

const {web3} = Reservoir;

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

contract.only('Governor', ([alice, minter, dev]) => {
    const supply = ether('80000000');
    it('should work', async () => {
        this.token = await SushiToken.new(supply, { from: minter });
        this.reservoir = await Reservoir.new({ from: minter });
        await this.token.transfer(this.reservoir.address, ether('100000'), { from: minter });
        this.chef = await MasterChef.new(this.token.address, this.reservoir.address, dev, '100', '0', '0', { from: alice });
        await this.reservoir.setApprove(this.token.address, this.chef.address, supply, { from: minter });
        this.lp = await MockERC20.new('LPToken', 'LP', '10000000000', { from: alice });
        this.lp2 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: alice });
        await this.chef.add('100', this.lp.address, true, { from: alice });
        await this.lp.approve(this.chef.address, '1000', { from: alice });
        await this.chef.deposit(0, '100', { from: alice });
        // Perform another deposit to make sure some SUSHIs are minted in that 1 block.
        await this.chef.deposit(0, '100', { from: alice });
        assert.equal((await this.token.balanceOf(alice)).valueOf(), '100');
        assert.equal((await this.token.balanceOf(dev)).valueOf(), '10');
        // Transfer ownership to timelock contract
        this.timelock = await Timelock.new(alice, time.duration.days(2), { from: alice });
        this.gov = await GovernorAlpha.new(this.timelock.address, this.token.address, alice, { from: alice });
        await this.timelock.setPendingAdmin(this.gov.address, { from: alice });
        await this.gov.__acceptAdmin({ from: alice });
        await this.chef.transferOwnership(this.timelock.address, { from: alice });
        await expectRevert(
            this.chef.add('100', this.lp2.address, true, { from: alice }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.gov.propose(
                [this.chef.address], ['0'], ['add(uint256,address,bool)'],
                [encodeParameters(['uint256', 'address', 'bool'], ['100', this.lp2.address, true])],
                'Add LP2',
                { from: alice },
            ),
            'GovernorAlpha::propose: proposer votes below proposal threshold',
        );

        await this.token.transfer(dev, ether('80000'), { from: minter });

        await this.token.delegate(dev, { from: dev });
        await time.advanceBlock();

        await this.gov.propose(
            [this.chef.address], ['0'], ['add(uint256,address,bool)'],
            [encodeParameters(['uint256', 'address', 'bool'], ['100', this.lp2.address, true])],
            'Add LP2',
            { from: dev },
        );
        await time.advanceBlock();
        await this.gov.castVote('1', true, { from: dev });
        await expectRevert(this.gov.queue('1'), "GovernorAlpha::queue: proposal can only be queued if it is succeeded");
        console.log("Advancing 17280 blocks. Will take a while...");
        for (let i = 0; i < 17280; ++i) {
            await time.advanceBlock();
        }
        await this.gov.queue('1');
        await expectRevert(this.gov.execute('1'), "Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
        await time.increase(time.duration.days(3));
        await this.gov.execute('1');
        assert.equal((await this.chef.poolLength()).valueOf(), '2');
    });
});
