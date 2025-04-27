import * as accountServices from "../../services/admin/accountServices.js";

export const getAllData = async (req, res, next) => {
  try {
    const {adminId} = req.params
    
    const accounts = await accountServices.findAllAccounts(adminId);
    res.json({
      status: 200,
      success: true,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};
export const getUserProfile = async (req, res, next) => {
  try {
    const { adminId, userId } = req.params;
    
    const userData = await accountServices.findUserById(adminId, userId);
    
    if (!userData) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found"
      });
    }
    
    res.json({
      status: 200,
      success: true,
      data: userData
    });
  } catch (error) {
    next(error);
  }
};
export const updateUserProfile = async (req, res, next) => {
  try {
    const { adminId, userId } = req.params;
    const updateData = req.body;
    
    const updatedUser = await accountServices.updateUserById(adminId, userId, updateData);
    
    if (!updatedUser) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found or you don't have permission to update this user"
      });
    }
    
    res.json({
      status: 200,
      success: true,
      message: "User profile updated successfully",
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};
export const getAccountByType = async (req, res, next) => {
  try {
    const { type } = req.query;
    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Account type is required"
      });
    }
    
    const accounts = await accountServices.findAccountsByType(type);
    res.status(200).json({
      success: true,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

export const updateAccountType = async (req, res, next) => {
  try {
    const { accode, accountType } = req.body;
    const {adminId} = req.params

    if (!accode || !accountType) {
      return res.status(400).json({
        success: false,
        message: "Account code and account type are required"
      });
    }
    
    const updatedAccount = await accountServices.updateAccountTypeById(accode,adminId, accountType);
    res.json({
      status:200,
      success: true,
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
};

export const updateMarginAmount = async (req, res, next) => {
  try {
    const { accode, margin } = req.body;
    const {adminId} = req.params
    if (!accode || margin === undefined) {
      return res.status(400).json({
        success: false,
        message: "Account code and margin amount are required"
      });
    }
    
    const updatedAccount = await accountServices.updateMargin(accode,adminId, margin);
    res.json({
      status:200,
      success: true,
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
};

export const updateFavoriteStatus = async (req, res, next) => {
  try {
    const { accode, isFavorite } = req.body;
    const {adminId} = req.params
    if (!accode || isFavorite === undefined) {
      return res.status(400).json({
        success: false,
        message: "Account code and favorite status are required"
      });
    }
    
    const updatedAccount = await accountServices.updateFavorite(accode,adminId, isFavorite);
    res.json({
      status:200,
      success: true,
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
};

export const filterAccounts = async (req, res, next) => {
  try {
    const filters = req.query;
    
    // Convert string "true"/"false" to boolean for is_favorite
    if (filters.is_favorite) {
      filters.is_favorite = filters.is_favorite === 'true';
    }
    
    const accounts = await accountServices.filterAccounts(filters);
    res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

export const insertAccount = async (req, res, next) => {
  try {
    const adminId = req.params.adminId
    
    const newAccount = await accountServices.createAccount(req.body, adminId);
    res.status(201).json({
      success: true,
      data: newAccount
    });
  } catch (error) {
    next(error);
  }
};

export const updateAccount = async (req, res, next) => {
  try {
    const { ACCODE , adminId } = req.params;
    const updatedAccount = await accountServices.updateAccountByCode(ACCODE,adminId, req.body);
    res.status(200).json({
      success: true,
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
};

export const deleteAccount = async (req, res, next) => {
  try {
    const { ACCODE,adminId } = req.params;
    const deletedAccount = await accountServices.deleteAccountByCode(ACCODE,adminId);
    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
      data: deletedAccount
    });
  } catch (error) {
    next(error);
  }
};