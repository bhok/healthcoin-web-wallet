define(['knockout',
    'common/dialog',
    'viewmodels/common/confirmation-dialog',
    'viewmodels/common/wallet-passphrase',
    'viewmodels/common/command',
    'patterns'], function(ko,dialog,ConfirmationDialog,WalletPassphrase,Command,patterns){
    var biomarkersType = function(options){
        var self = this, opts = options || {};
        this.wallet = opts.parent;

        this.txcommentBiomarker = ko.observable("").extend(
            {
                pattern: { params: patterns.biomarker, message: 'Not a valid bio-marker' },
                required: true
            });

        this.account = ko.observable("");

        // Recipient address for biomarker submission it the User's account address. (Send to self.)
        this.recipientAddress = ko.observable("").extend(
            {
                pattern: { params: patterns.healthcoin, message: 'Not a valid address' },
                required: true
            });

        this.amount = ko.observable(0.00001).extend(
            {
                number: true,
                required: true
            });

        this.minerFee = ko.observable(0.00001);

        this.canSend = ko.computed(function(){
            var amount = self.amount(),
                isNumber = !isNaN(amount),
                biomarker = self.txcommentBiomarker(),
                biomarkerValid = self.txcommentBiomarker.isValid(),
                address = self.recipientAddress(),
                addressValid = self.recipientAddress.isValid(),
                amountValid = self.amount.isValid(),
                available = self.wallet.walletStatus.available(),
                canSend;

            canSend = isNumber && biomarkerValid && biomarker.length > 0 && addressValid && amountValid && available > 0 && address.length > 0 && amount > 0;
            return canSend;
        });

        this.isEncrypted = ko.computed(function(){
            return self.wallet.walletStatus.encryptionStatus();
        });
    };

    biomarkersType.prototype.load = function(User, node_id){
        var self = this;
        if (self.account() === ""){
            var found = false;
			// Get the address/account for the node_id
			var wallet = User.wallet.filter(function(wal){
				if(!found && wal.node_id === node_id){
                    found = true;
                    self.account(wal.account);
                    self.recipientAddress(wal.address); // Send to self
					return wal;
				}
			});
			if (!found)
                console.log("Error: wallet not found for this node:" + JSON.stringify(wallet) + " node_id:" + node_id);
        }
    };

    function lockWallet(isEncrypted){
        var walletlockCommand = new Command('walletlock').execute()
            .done(function(){
                console.log('Wallet relocked');
            })
            .fail(function(error){
                if (isEncrypted){
                    dialog.notification(error.message, "Failed to re-lock wallet");
                }
            });
        return walletlockCommand;
    }

    biomarkersType.prototype.unlockWallet= function(isEncrypted){
        var walletPassphrase = new WalletPassphrase({canSpecifyStaking:true, stakingOnly:false}),
            passphraseDialogPromise = $.Deferred();

        walletPassphrase.userPrompt(false, 'Wallet unlock', 'Unlock the wallet for sending','OK')
            .done(function(){
                passphraseDialogPromise.resolve(walletPassphrase.walletPassphrase());                            
            })
            .fail(function(error){
                if (isEncrypted){
                    passphraseDialogPromise.reject(error);
                }
            });
        return passphraseDialogPromise;
    };

    biomarkersType.prototype.sendSubmit = function(){
        var self = this;
        console.log("Send request submitted, unlocking wallet for sending...");
        if(self.canSend()){
            lockWallet(self.isEncrypted()).done(function(){
                console.log('Wallet locked. Prompting for confirmation...');
                self.sendConfirm(self.amount())
                    .done(function(){
                        self.unlockWallet(self.isEncrypted())
                            .done(function(result){
                                console.log("Wallet successfully unlocked, sending...");
                                self.sendToAddress(result);
                            })
                            .fail(function(error){
                                dialog.notification(error.message);
                            });
                    })
                    .fail(function(error){
                        dialog.notification(error.message);
                    });
            });
        }
        else{
            console.log("Can't send. Form in invalid state.");
        }
    };

    biomarkersType.prototype.sendConfirm = function(amount){
        var self = this, 
            sendConfirmDeferred = $.Deferred(),
            sendConfirmDialog = new ConfirmationDialog({
                title: 'Send Confirm',
                context: self,
                allowClose: false,
                message: 'You are about to send encrypted bio-marker data to the Healthcoin (HCN) network. Do you wish to continue?',
                affirmativeButtonText: 'Yes',
                negativeButtonText: 'No',
                affirmativeHandler: function(){ sendConfirmDeferred.resolve(); },
                negativeHandler: function(){ sendConfirmDeferred.reject(); }
            });
        sendConfirmDialog.open();
        return sendConfirmDeferred.promise();
    };

    biomarkersType.prototype.encodeBase64 = function(str){
        if (str) {
            return window.btoa(str);
        }
        return "";
    };

    biomarkersType.prototype.sendToAddress = function(auth){
        var self = this;

        // hash the text in base64 and append to 'hcbm:'
        var hcbm = encodeURIComponent("hcbm:" + this.encodeBase64(self.txcommentBiomarker()));

        sendCommand = new Command('sendfrom',
            [self.account(), self.recipientAddress(), self.amount(), 1, "Biomarker", self.recipientAddress(), hcbm]).execute()
            .done(function(txid){
                console.log("DEBUG: Txid:" + txid);
                self.txcommentBiomarker('');
                //self.recipientAddress('');
                //self.amount(0);

                lockWallet(self.isEncrypted())
                    .done(function(){
                        if (self.isEncrypted()){
                            var walletPassphrase = new WalletPassphrase({
                                walletPassphrase: auth,
                                forEncryption: false,
                                stakingOnly: true
                            });
                            console.log("Wallet successfully relocked. Opening for staking...");
                            walletPassphrase.openWallet(false)
                                .done(function() {
                                    auth = "";
                                    console.log("Wallet successfully re-opened for staking");
                                    self.wallet.refresh();
                                });
                        }
                    });
            })
            .fail(function(error){
                console.log("Send error:");
                console.log(error);
                dialog.notification(error.message);
            });
   
    };
    return biomarkersType;
});
