import * as billingService from './service.js';

export async function getSubscription(req, res, next) {
  try { res.json({ subscription: await billingService.getCompanySubscription(req.companyMembership.companyId) }); }
  catch (error) { next(error); }
}

export async function cancelSubscription(req, res, next) {
  try {
    const subscription = await billingService.cancelCompanySubscription(req.companyMembership.companyId, req.auth.user.id);
    res.json({ subscription });
  } catch (error) { next(error); }
}
