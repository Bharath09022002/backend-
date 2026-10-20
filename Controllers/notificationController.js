import Notification from "../Schemas/Notification.js";
import { sendPushNotification } from "../Utils/sendNotification.js";

const ok = (res, status, message, result = {}) => res.status(status).json({ success: true, message, result });
const fail = (res, status, message, result = {}) => res.status(status).json({ success: false, message, result });

const getRecipient = (req) => {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "technician") {
    return { recipientId: req.user.technicianProfileId || req.user.userId, recipientType: "technician" };
  }
  if (role === "admin" || role === "owner") {
    return { recipientId: req.user.userId, recipientType: "admin" };
  }
  return { recipientId: req.user.userId, recipientType: "customer" };
};

const notExpired = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

export const listNotifications = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cursor = req.query.cursor;
    const query = { recipientId, recipientType, ...notExpired() };
    if (cursor) {
      const d = new Date(cursor);
      if (!isNaN(d)) query.createdAt = { $lt: d };
    }
    const items = await Notification.find(query).sort({ createdAt: -1 }).limit(limit + 1).lean();
    let nextCursor = null;
    if (items.length > limit) {
      nextCursor = items[limit].createdAt.toISOString();
      items.length = limit;
    }

    const formattedItems = items.map((item) => ({
      ...item,
      id: item._id,
      _id: item._id,
      message: item.body,
      read: Boolean(item.readAt),
      isRead: Boolean(item.readAt),
    }));

    return res.status(200).json({
      success: true,
      message: "Notifications",
      data: formattedItems,
      result: {
        items: formattedItems,
        nextCursor,
      },
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const unreadCount = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    const count = await Notification.countDocuments({
      recipientId,
      recipientType,
      readAt: null,
      ...notExpired(),
    });

    return res.status(200).json({
      success: true,
      message: "Unread count",
      count,
      unreadCount: count,
      data: { count, unreadCount: count },
      result: { count, unreadCount: count },
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const sendTestNotification = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    const { title, body, type, id, route } = req.body || {};

    const pushTitle = title || "Test Notification";
    const pushBody = body || "This is a test notification from RightTouch backend";
    const notificationType = type || "booking";
    const targetId = id || "test_123";
    const targetRoute = route || (notificationType === "quote" ? "/product-quotations" : `/bookings/${targetId}`);

    // 1. Create in-app notification record
    const notification = await Notification.create({
      recipientId,
      recipientType,
      eventType: "TEST_NOTIFICATION",
      title: pushTitle,
      body: pushBody,
      data: {
        type: notificationType,
        id: String(targetId),
        bookingId: String(targetId),
        route: targetRoute,
      },
      category: "test",
    });

    // 2. Dispatch FCM push
    const pushResult = await sendPushNotification(
      recipientId,
      {
        title: pushTitle,
        body: pushBody,
        data: {
          type: notificationType,
          id: String(targetId),
          bookingId: String(targetId),
          route: targetRoute,
        },
      },
      { recipientType }
    );

    return res.status(200).json({
      success: true,
      message: "Test notification dispatched",
      result: {
        notification: {
          ...notification.toObject(),
          id: notification._id,
          read: false,
          isRead: false,
          message: notification.body,
        },
        pushResult,
      },
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const markRead = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId, recipientType, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();
    if (!n) return fail(res, 404, "Notification not found or already read");
    ok(res, 200, "Marked read", { id: req.params.id });
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const markReceived = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    await Notification.updateOne(
      { _id: req.params.id, recipientId, recipientType, receivedAt: null },
      { $set: { receivedAt: new Date() } }
    );
    ok(res, 200, "Marked received");
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const markOpened = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    await Notification.updateOne(
      { _id: req.params.id, recipientId, recipientType, openedAt: null },
      { $set: { openedAt: new Date() } }
    );
    ok(res, 200, "Marked opened");
  } catch (e) {
    fail(res, 500, e.message);
  }
};

export const markReadAll = async (req, res) => {
  try {
    const { recipientId, recipientType } = getRecipient(req);
    const r = await Notification.updateMany(
      { recipientId, recipientType, readAt: null },
      { $set: { readAt: new Date() } }
    );
    ok(res, 200, "Marked all read", { updated: r.modifiedCount });
  } catch (e) {
    fail(res, 500, e.message);
  }
};
