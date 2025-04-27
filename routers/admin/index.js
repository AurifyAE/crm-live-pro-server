import express from "express";
import { 
  getAllData,
  updateAccountType,
  getAccountByType,
  updateMarginAmount,
  updateFavoriteStatus,
  filterAccounts,
  insertAccount,
  updateAccount,
  deleteAccount,
  getUserProfile,
  updateUserProfile
} from "../../controllers/admin/accountControllers.js";
import {loginAdmin} from '../../controllers/superAdmin/adminControllers.js'
import { createTrade, getUserTrades, updateTrade } from "../../controllers/admin/tradingController.js";
const router = express.Router();
router.post("/login", loginAdmin);
router.get("/fetch-data/:adminId", getAllData);
router.get("/user-profile/:adminId/:userId", getUserProfile);
router.put("/user-profile/:adminId/:userId", updateUserProfile);
router.put("/update-accountType/:adminId", updateAccountType);
router.get("/account-type", getAccountByType);
router.put('/update-margin/:adminId', updateMarginAmount);
router.put('/update-favorite/:adminId', updateFavoriteStatus);
router.get('/fetch-filter', filterAccounts);
router.post('/accounts/:adminId', insertAccount);
router.put('/accounts/:ACCODE/:adminId', updateAccount);
router.delete('/accounts/:ACCODE/:adminId', deleteAccount);
//order management 
router.post('/create-order/:adminId', createTrade);
router.get('/order/:adminId', getUserTrades);
router.patch('/order/:adminId/:orderId',updateTrade);
export default router;
