import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/config/services';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payment Logger');
  private readonly stripe = new Stripe(envs.stripeSecret);

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ){}

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;
    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });
    const session = await this.stripe.checkout.sessions.create({
      payment_intent_data: {
        metadata: {
            orderId: orderId,
        },
      },
      line_items: lineItems,
      mode: 'payment',
      success_url: envs.successUrl,
      cancel_url: envs.cancelUrl,
    });

    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url
    };
  }

  stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;

    const endpointSecret = envs.endpointSecret;
    try {
        event = this.stripe.webhooks.constructEvent(req["rawBody"], sig, endpointSecret);
    } catch (error) {
        res.status(400).send(`Webhook Error: ${error.message}`);
        return;
    }

    switch(event.type){
        case 'charge.succeeded': {
            const chargeSucceded = event.data.object;
            const payload = {
              stripePaymentId: chargeSucceded.id,
              orderId: chargeSucceded.metadata.orderId,
              receiptUrl: chargeSucceded.receipt_url
            }
              this.client.emit('payment.succeeded', payload);
            break;
        }
        default:
            console.log(`Event ${event.type} not handled`)
    }
    return res.status(200).json({ sig });
  }
}
