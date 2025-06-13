import { Component, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: `auth.component.html`,
  styleUrls: [`auth.component.css`]
})
export class AuthComponent implements OnInit, OnDestroy {
  @Output() authSuccess = new EventEmitter<void>();

  currentStep: 'phone' | 'otp' = 'phone';
  selectedCountryCode = '+1';
  phoneNumber = '';
  otpCode = '';
  displayName = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(private authService: AuthService) {}

  async ngOnInit() {
    setTimeout(() => {
      this.initRecaptcha();
    }, 100);
  }

  ngOnDestroy() {
    this.authService.cleanup();
  }

  private async initRecaptcha() {
    try {
      await this.authService.initRecaptcha('recaptcha-container');
    } catch (error) {
      console.error('Error initializing reCAPTCHA:', error);
      this.setError('Failed to load security verification. Please refresh the page.');
    }
  }

  async sendOTP() {
    if (!this.phoneNumber.trim()) {
      this.setError('Please enter a valid phone number');
      return;
    }

    this.clearMessages();
    this.isLoading = true;

    try {
      const fullPhoneNumber = this.selectedCountryCode + this.phoneNumber;
      await this.authService.sendOTP(fullPhoneNumber);
      
      this.setSuccess('Verification code sent! Check your messages.');
      this.currentStep = 'otp';
      
      // Auto-focus OTP input after transition
      setTimeout(() => {
        const otpInput = document.querySelector('.otp-input') as HTMLInputElement;
        if (otpInput) otpInput.focus();
      }, 100);
      
    } catch (error: any) {
      console.error('Error sending OTP:', error);
      this.setError(error.message || 'Failed to send verification code');
    } finally {
      this.isLoading = false;
    }
  }

  async verifyOTP() {
    if (this.otpCode.length !== 6) {
      this.setError('Please enter the complete 6-digit code');
      return;
    }

    this.clearMessages();
    this.isLoading = true;

    try {
      await this.authService.verifyOTP(this.otpCode, this.displayName || undefined);
      this.setSuccess('Phone verified successfully! Welcome to MeetClone.');
      setTimeout(() => {
        this.authSuccess.emit();
      }, 1500);
      
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      this.setError(error.message || 'Failed to verify code');
    } finally {
      this.isLoading = false;
    }
  }

  goBack() {
    this.currentStep = 'phone';
    this.otpCode = '';
    this.clearMessages();
    setTimeout(() => {
      this.initRecaptcha();
    }, 100);
  }

  private setError(message: string) {
    this.errorMessage = message;
    this.successMessage = '';
  }

  private setSuccess(message: string) {
    this.successMessage = message;
    this.errorMessage = '';
  }

  private clearMessages() {
    this.errorMessage = '';
    this.successMessage = '';
  }
}