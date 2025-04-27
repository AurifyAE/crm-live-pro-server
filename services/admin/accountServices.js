import Account from "../../models/AccountSchema.js";
import { createAppError } from "../../utils/errorHandler.js";
const generateRandomRefMid = () => {
  // Generate a random number between 10000 and 99999 (5 digits)
  return Math.floor(10000 + Math.random() * 90000);
};

// Function to check if a REFMID is unique and generate a new one if needed
const getUniqueRefMid = async () => {
  let isUnique = false;
  let refMid;
  
  // Keep trying until we find a unique REFMID
  while (!isUnique) {
    refMid = generateRandomRefMid();
    // Check if this REFMID already exists
    const existingAccount = await Account.findOne({ REFMID: refMid });
    if (!existingAccount) {
      isUnique = true;
    }
  }
  
  return refMid;
};

export const findUserById = async (adminId, userId) => {
  try {
    // Find a specific user that was added by the admin
    const user = await Account.findOne({ 
      _id: userId,
      addedBy: adminId 
    });
    
    return user;
  } catch (error) {
    throw createAppError(`Error fetching user: ${error.message}`, 500);
  }
};

export const findAllAccounts = async (adminId) => {
  try {
    // Find only accounts added by the specific admin
    const accounts = await Account.find({ addedBy: adminId })
    
    return accounts;
  } catch (error) {
    throw createAppError(`Error fetching accounts: ${error.message}`, 500);
  }
};

export const findAccountsByType = async (accountType) => {
  try {
    const accounts = await Account.find({ Account_Type: accountType }).populate("addedBy", "userName email");
    return accounts;
  } catch (error) {
    throw createAppError(`Error fetching accounts with type ${accountType}`, 500);
  }
};

export const updateAccountTypeById = async (accode,adminId, newType) => {
  try {
    const updatedAccount = await Account.findOneAndUpdate(
      { ACCODE: accode, addedBy: adminId },
      { Account_Type: newType },
      { new: true }
    );
    
    if (!updatedAccount) {
      throw createAppError("Account not found", 404);
    }
    
    return updatedAccount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createAppError(`Error updating account type: ${error.message}`, 500);
  }
};

export const updateMargin = async (accode, adminId, margin) => {
  try {
    const updatedAccount = await Account.findOneAndUpdate(
      { ACCODE: accode, addedBy: adminId },
      { margin: margin },
      { new: true }
    );
    
    if (!updatedAccount) {
      throw createAppError("Account not found or you don't have permission to update it", 404);
    }
    
    return updatedAccount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createAppError(`Error updating margin: ${error.message}`, 500);
  }
};

export const updateFavorite = async (accode, adminId, isFavorite) => {
  try {
    const updatedAccount = await Account.findOneAndUpdate(
      { ACCODE: accode, addedBy: adminId },
      { is_favorite: isFavorite },
      { new: true }
    );
    
    if (!updatedAccount) {
      throw createAppError("Account not found or you don't have permission to update it", 404);
    }
    
    return updatedAccount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createAppError(`Error updating favorite status: ${error.message}`, 500);
  }
};

export const filterAccounts = async (filterParams) => {
  try {
    const query = {};
    
    // Apply filters based on provided parameters
    if (filterParams.account_type) {
      query.Account_Type = filterParams.account_type;
    }
    
    if (filterParams.is_favorite !== undefined) {
      query.is_favorite = filterParams.is_favorite;
    }
    
    if (filterParams.search) {
      // Case-insensitive search across multiple fields
      query.$or = [
        { ACCOUNT_HEAD: { $regex: filterParams.search, $options: 'i' } },
        { ACCODE: { $regex: filterParams.search, $options: 'i' } }
      ];
    }
    
    const accounts = await Account.find(query).populate("addedBy", "userName email");
    return accounts;
  } catch (error) {
    throw createAppError(`Error filtering accounts: ${error.message}`, 500);
  }
};

export const createAccount = async (accountData, adminId) => {
  try {
    // Check if an account with the same REFMID already exists for this admin
    const existingAccount = await Account.findOne({ 
      ACCODE: accountData.ACCODE,
      addedBy: adminId 
    });
    
    if (existingAccount) {
      throw createAppError("Account with this ACCODE already exists for your admin account", 400);
    }

    accountData.addedBy = adminId;
     // Generate a unique REFMID
     accountData.REFMID = await getUniqueRefMid();
     
    const newAccount = new Account(accountData);
    await newAccount.save();
    return newAccount;
  } catch (error) {
    if (error.code === 11000) {
      throw createAppError("Account with this code already exists", 400);
    }
    throw createAppError(`Error creating account: ${error.message}`, 500);
  }
};

export const updateAccountByCode = async (accode, adminId, updateData) => {
  try {
    // Find and update account with the specific ACCODE and belonging to the admin
    const updatedAccount = await Account.findOneAndUpdate(
      { ACCODE: accode, addedBy: adminId },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedAccount) {
      throw createAppError("Account not found or you don't have permission to update it", 404);
    }
    
    return updatedAccount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createAppError(`Error updating account: ${error.message}`, 500);
  }
};

export const updateUserById = async (adminId, userId, updateData) => {
  try {
    // Sanitize the update data to prevent modifying restricted fields
    const allowedUpdates = [
      'lastName','firstName', 'email', 'phoneNumber', 'address', 
      'accountStatus', 'kycStatus', 'userSpread'
    ];
    
    const sanitizedData = {};
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        sanitizedData[key] = updateData[key];
      }
    });
    
    // Find user by ID and ensure it belongs to the admin
    const updatedUser = await Account.findOneAndUpdate(
      { _id: userId, addedBy: adminId },
      { $set: sanitizedData },
      { new: true } // Return the updated document
    );
    
    return updatedUser;
  } catch (error) {
    throw createAppError(`Error updating user: ${error.message}`, 500);
  }
};
export const deleteAccountByCode = async (accode, adminId) => {
  try {
    // Find and delete account with the specific ACCODE and belonging to the admin
    const deletedAccount = await Account.findOneAndDelete({ 
      ACCODE: accode, 
      addedBy:adminId 
    });
    console.log(deletedAccount)
    if (!deletedAccount) {
      throw createAppError("Account not found or you don't have permission to delete it", 404);
    }
    
    return deletedAccount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createAppError(`Error deleting account: ${error.message}`, 500);
  }
};