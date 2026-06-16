export declare class AuthService {
    private readonly logger;
    register(username: string, password: string): Promise<{
        token: string;
        expiresAt: string;
        trialDaysLeft: number;
    }>;
    login(username: string, password: string): Promise<{
        token: string;
        expiresAt: string;
        trialDaysLeft: number;
        username: string;
    }>;
    verifyToken(token: string): {
        userId: string;
        username: string;
        expiresAt: string;
    } | null;
    getUserStatus(userId: string): Promise<{
        username: string;
        isExpired: boolean;
        expiresAt: string;
        daysLeft: number;
        isActive: boolean;
    } | null>;
    extendSubscription(username: string, extraDays: number): Promise<{
        newExpiry: string;
        totalDaysLeft: number;
    }>;
    setExpiryDate(username: string, expiryDate: string): Promise<{
        newExpiry: string;
        totalDaysLeft: number;
    }>;
    private generateToken;
    private getEffectiveExpiry;
    private getDaysLeft;
}
